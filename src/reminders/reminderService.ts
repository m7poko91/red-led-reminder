import { randomUUID } from "node:crypto";
import { getLocalDateKey } from "../time/dateKey.js";
import type {
  ReminderAttempt,
  ReminderCallStatus,
  ReminderRecord,
  ReminderStateRepository,
  ReminderStatusCallback,
  VoiceClient
} from "./types.js";

const ANSWERED_STATUSES = new Set(["answered", "in-progress", "completed"]);
const RETRYABLE_STATUSES = new Set(["no-answer", "busy", "failed", "canceled"]);
const ACTIVE_STATUSES = new Set(["created", "queued", "initiated", "ringing", "in-progress", "answered"]);

export interface ReminderServiceOptions {
  logger?: Pick<Console, "error" | "info" | "warn">;
  maxRetryAttempts: number;
  now?: () => Date;
  reminderMessage: string;
  retryDelayMs: number;
  setTimeout?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  clearTimeout?: (timeout: NodeJS.Timeout) => void;
  timeZone: string;
}

export class ReminderService {
  private readonly logger: Pick<Console, "error" | "info" | "warn">;
  private readonly maxRetryAttempts: number;
  private readonly now: () => Date;
  private readonly reminderMessage: string;
  private readonly retryDelayMs: number;
  private readonly setTimer: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  private readonly clearTimer: (timeout: NodeJS.Timeout) => void;
  private readonly state: ReminderStateRepository;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly timeZone: string;
  private readonly voiceClient: VoiceClient;

  constructor(voiceClient: VoiceClient, state: ReminderStateRepository, options: ReminderServiceOptions) {
    this.voiceClient = voiceClient;
    this.state = state;
    this.logger = options.logger ?? console;
    this.maxRetryAttempts = options.maxRetryAttempts;
    this.now = options.now ?? (() => new Date());
    this.reminderMessage = options.reminderMessage;
    this.retryDelayMs = options.retryDelayMs;
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer = options.clearTimeout ?? clearTimeout;
    this.timeZone = options.timeZone;
  }

  async startNightlyReminder(at: Date = this.now()): Promise<{ placed: boolean; reason?: string }> {
    const date = getLocalDateKey(at, this.timeZone);
    const attempt = createAttempt(this.now());
    let shouldPlaceCall = false;
    let reason: string | undefined;

    await this.state.updateReminder(date, (record) => {
      if (record.answeredAt) {
        reason = "already_answered";
        return;
      }

      if (record.retry) {
        reason = "retry_already_scheduled";
        return;
      }

      if (hasActiveAttempt(record)) {
        reason = "active_attempt_exists";
        return;
      }

      record.closedAt = undefined;
      record.attempts.push(attempt);
      shouldPlaceCall = true;
    });

    if (!shouldPlaceCall) {
      return { placed: false, reason };
    }

    await this.placeAndTrackAttempt(date, attempt.id);

    return { placed: true };
  }

  async handleCallStatus(callback: ReminderStatusCallback): Promise<void> {
    const callStatus = normalizeStatus(callback.callStatus);
    const locatedAttempt = await this.locateAttempt(callback);

    if (!locatedAttempt) {
      this.logger.warn(`Received status for unknown Twilio call SID ${callback.callSid}`);
      return;
    }

    const { date, attemptId } = locatedAttempt;
    const now = this.now();
    let retryDueAt: string | undefined;
    let shouldScheduleRetry = false;

    await this.state.updateReminder(date, (record) => {
      const attempt = record.attempts.find((item) => item.id === attemptId);

      if (!attempt) {
        return;
      }

      attempt.callSid = callback.callSid;
      attempt.status = callStatus;
      attempt.updatedAt = now.toISOString();

      if (ANSWERED_STATUSES.has(callStatus)) {
        const answeredAt = attempt.answeredAt ?? now.toISOString();
        attempt.answeredAt = answeredAt;
        attempt.completedAt = callStatus === "completed" ? now.toISOString() : attempt.completedAt;
        record.answeredAt = record.answeredAt ?? answeredAt;
        record.closedAt = record.closedAt ?? answeredAt;
        record.retry = undefined;
        return;
      }

      if (!RETRYABLE_STATUSES.has(callStatus)) {
        return;
      }

      attempt.completedAt = now.toISOString();

      if (record.answeredAt || record.retry || getRetryAttemptCount(record) >= this.maxRetryAttempts) {
        record.closedAt = record.closedAt ?? now.toISOString();
        return;
      }

      retryDueAt = new Date(now.getTime() + this.retryDelayMs).toISOString();
      record.retry = {
        afterAttemptId: attempt.id,
        dueAt: retryDueAt
      };
      shouldScheduleRetry = true;
    });

    if (shouldScheduleRetry && retryDueAt) {
      this.scheduleRetry(date, retryDueAt);
    }
  }

  async resumePendingRetries(): Promise<void> {
    const reminders = await this.state.listReminders();

    for (const reminder of reminders) {
      if (!reminder.answeredAt && reminder.retry) {
        this.scheduleRetry(reminder.date, reminder.retry.dueAt);
      }
    }
  }

  private async locateAttempt(
    callback: ReminderStatusCallback
  ): Promise<{ date: string; attemptId: string } | undefined> {
    if (callback.date && callback.attemptId) {
      const reminder = await this.state.getReminder(callback.date);
      const attempt = reminder?.attempts.find((item) => item.id === callback.attemptId);

      if (attempt) {
        return { date: callback.date, attemptId: callback.attemptId };
      }
    }

    const located = await this.state.findAttemptByCallSid(callback.callSid);

    return located ? { date: located.date, attemptId: located.attempt.id } : undefined;
  }

  private async runScheduledRetry(date: string): Promise<void> {
    this.timers.delete(date);

    const retryAttempt = createAttempt(this.now());
    let shouldPlaceCall = false;

    await this.state.updateReminder(date, (record) => {
      if (!record.retry || record.answeredAt) {
        return;
      }

      const dueAt = new Date(record.retry.dueAt);

      if (dueAt.getTime() > this.now().getTime()) {
        this.scheduleRetry(date, record.retry.dueAt);
        return;
      }

      retryAttempt.retryForAttemptId = record.retry.afterAttemptId;
      record.retry = undefined;
      record.attempts.push(retryAttempt);
      shouldPlaceCall = true;
    });

    if (shouldPlaceCall) {
      await this.placeAndTrackAttempt(date, retryAttempt.id);
    }
  }

  private scheduleRetry(date: string, dueAtIso: string): void {
    const existingTimer = this.timers.get(date);

    if (existingTimer) {
      this.clearTimer(existingTimer);
    }

    const delayMs = Math.max(0, new Date(dueAtIso).getTime() - this.now().getTime());
    const timer = this.setTimer(() => {
      this.runScheduledRetry(date).catch((error: unknown) => {
        this.logger.error("Failed to run scheduled reminder retry", error);
      });
    }, delayMs);

    this.timers.set(date, timer);
  }

  private async placeAndTrackAttempt(date: string, attemptId: string): Promise<void> {
    try {
      const call = await this.voiceClient.placeReminderCall({
        attemptId,
        date,
        message: this.reminderMessage
      });
      const updatedAt = this.now().toISOString();

      await this.state.updateReminder(date, (record) => {
        const attempt = record.attempts.find((item) => item.id === attemptId);

        if (!attempt) {
          return;
        }

        attempt.callSid = call.callSid;
        attempt.status = "queued";
        attempt.updatedAt = updatedAt;
      });
      this.logger.info(`Placed red LED reminder call for ${date}: ${call.callSid}`);
    } catch (error) {
      const failedAt = this.now().toISOString();

      await this.state.updateReminder(date, (record) => {
        const attempt = record.attempts.find((item) => item.id === attemptId);

        if (!attempt) {
          return;
        }

        attempt.status = "failed";
        attempt.completedAt = failedAt;
        attempt.updatedAt = failedAt;
      });

      throw error;
    }
  }
}

function createAttempt(now: Date): ReminderAttempt {
  const timestamp = now.toISOString();

  return {
    id: randomUUID(),
    status: "created",
    startedAt: timestamp,
    updatedAt: timestamp
  };
}

function getRetryAttemptCount(record: ReminderRecord): number {
  return record.attempts.filter((attempt) => attempt.retryForAttemptId).length;
}

function hasActiveAttempt(record: ReminderRecord): boolean {
  return record.attempts.some((attempt) => ACTIVE_STATUSES.has(normalizeStatus(attempt.status)));
}

function normalizeStatus(status: string): ReminderCallStatus | string {
  return status.trim().toLowerCase();
}
