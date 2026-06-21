import { randomUUID } from "node:crypto";
import { getLocalDateKey } from "../time/dateKey.js";
import type {
  IncomingReminderMessage,
  MessagingClient,
  ReminderAttempt,
  ReminderMessageStatus,
  ReminderMessageStatusCallback,
  ReminderRecord,
  ReminderStateRepository
} from "./types.js";

const ACKNOWLEDGEMENT_WORDS = new Set(["done", "yes", "y", "ok", "okay", "complete", "completed"]);
const ACTIVE_STATUSES = new Set(["created", "queued", "accepted", "scheduled", "sent", "delivered"]);

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
  private readonly messagingClient: MessagingClient;
  private readonly now: () => Date;
  private readonly reminderMessage: string;
  private readonly retryDelayMs: number;
  private readonly setTimer: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  private readonly clearTimer: (timeout: NodeJS.Timeout) => void;
  private readonly state: ReminderStateRepository;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly timeZone: string;

  constructor(messagingClient: MessagingClient, state: ReminderStateRepository, options: ReminderServiceOptions) {
    this.messagingClient = messagingClient;
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
    let shouldSendMessage = false;
    let reason: string | undefined;

    await this.state.updateReminder(date, (record) => {
      if (record.acknowledgedAt) {
        reason = "already_acknowledged";
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
      shouldSendMessage = true;
    });

    if (!shouldSendMessage) {
      return { placed: false, reason };
    }

    await this.sendAndTrackAttempt(date, attempt.id);

    return { placed: true };
  }

  async handleMessageStatus(callback: ReminderMessageStatusCallback): Promise<void> {
    const messageStatus = normalizeStatus(callback.messageStatus);
    const locatedAttempt = await this.locateAttempt(callback);

    if (!locatedAttempt) {
      this.logger.warn(`Received status for unknown Twilio message SID ${callback.messageSid}`);
      return;
    }

    const { date, attemptId } = locatedAttempt;
    const now = this.now();

    await this.state.updateReminder(date, (record) => {
      const attempt = record.attempts.find((item) => item.id === attemptId);

      if (!attempt) {
        return;
      }

      attempt.messageSid = callback.messageSid;
      attempt.status = messageStatus;
      attempt.updatedAt = now.toISOString();

      if (messageStatus === "failed" || messageStatus === "undelivered") {
        attempt.completedAt = now.toISOString();
      }
    });
  }

  async handleIncomingMessage(message: IncomingReminderMessage): Promise<{ acknowledged: boolean }> {
    if (!isAcknowledgement(message.body)) {
      return { acknowledged: false };
    }

    const date = getLocalDateKey(this.now(), this.timeZone);
    const acknowledgedAt = this.now().toISOString();
    let acknowledged = false;

    await this.state.updateReminder(date, (record) => {
      if (record.acknowledgedAt) {
        acknowledged = true;
        return;
      }

      const latestAttempt = getLatestAttempt(record);

      if (!latestAttempt) {
        return;
      }

      latestAttempt.status = "acknowledged";
      latestAttempt.acknowledgedAt = acknowledgedAt;
      latestAttempt.completedAt = acknowledgedAt;
      latestAttempt.updatedAt = acknowledgedAt;
      record.acknowledgedAt = acknowledgedAt;
      record.closedAt = acknowledgedAt;
      record.retry = undefined;
      acknowledged = true;
    });

    if (acknowledged) {
      this.cancelRetry(date);
    }

    return { acknowledged };
  }

  async resumePendingRetries(): Promise<void> {
    const reminders = await this.state.listReminders();

    for (const reminder of reminders) {
      if (!reminder.acknowledgedAt && reminder.retry) {
        this.scheduleRetry(reminder.date, reminder.retry.dueAt);
      }
    }
  }

  private async locateAttempt(
    callback: ReminderMessageStatusCallback
  ): Promise<{ date: string; attemptId: string } | undefined> {
    if (callback.date && callback.attemptId) {
      const reminder = await this.state.getReminder(callback.date);
      const attempt = reminder?.attempts.find((item) => item.id === callback.attemptId);

      if (attempt) {
        return { date: callback.date, attemptId: callback.attemptId };
      }
    }

    const located = await this.state.findAttemptByMessageSid(callback.messageSid);

    return located ? { date: located.date, attemptId: located.attempt.id } : undefined;
  }

  private async runScheduledRetry(date: string): Promise<void> {
    this.timers.delete(date);

    const retryAttempt = createAttempt(this.now());
    let shouldSendMessage = false;

    await this.state.updateReminder(date, (record) => {
      if (!record.retry || record.acknowledgedAt) {
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
      shouldSendMessage = true;
    });

    if (shouldSendMessage) {
      await this.sendAndTrackAttempt(date, retryAttempt.id);
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

  private cancelRetry(date: string): void {
    const existingTimer = this.timers.get(date);

    if (existingTimer) {
      this.clearTimer(existingTimer);
      this.timers.delete(date);
    }
  }

  private async sendAndTrackAttempt(date: string, attemptId: string): Promise<void> {
    try {
      const message = await this.messagingClient.sendReminderMessage({
        attemptId,
        date,
        message: this.reminderMessage
      });
      const updatedAt = this.now().toISOString();
      let retryDueAt: string | undefined;

      await this.state.updateReminder(date, (record) => {
        const attempt = record.attempts.find((item) => item.id === attemptId);

        if (!attempt) {
          return;
        }

        attempt.messageSid = message.messageSid;
        attempt.status = "queued";
        attempt.updatedAt = updatedAt;

        if (!record.acknowledgedAt && getRetryAttemptCount(record) < this.maxRetryAttempts) {
          retryDueAt = new Date(this.now().getTime() + this.retryDelayMs).toISOString();
          record.retry = {
            afterAttemptId: attempt.id,
            dueAt: retryDueAt
          };
        } else if (!record.acknowledgedAt) {
          record.closedAt = record.closedAt ?? updatedAt;
        }
      });

      if (retryDueAt) {
        this.scheduleRetry(date, retryDueAt);
      }

      this.logger.info(`Sent red LED reminder text for ${date}: ${message.messageSid}`);
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

function getLatestAttempt(record: ReminderRecord): ReminderAttempt | undefined {
  return record.attempts.at(-1);
}

function hasActiveAttempt(record: ReminderRecord): boolean {
  return record.attempts.some((attempt) => ACTIVE_STATUSES.has(normalizeStatus(attempt.status)));
}

function isAcknowledgement(body: string): boolean {
  return ACKNOWLEDGEMENT_WORDS.has(body.trim().toLowerCase());
}

function normalizeStatus(status: string): ReminderMessageStatus | string {
  return status.trim().toLowerCase();
}
