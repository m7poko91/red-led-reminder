import { describe, expect, it } from "vitest";
import { ReminderService } from "../src/reminders/reminderService.js";
import type {
  ReminderCallRequest,
  ReminderCallResult,
  ReminderRecord,
  ReminderStateRepository,
  VoiceClient
} from "../src/reminders/types.js";

describe("ReminderService", () => {
  it("places one nightly call and suppresses additional calls after the call is answered", async () => {
    const voiceClient = new FakeVoiceClient();
    const state = new MemoryReminderStateStore();
    const service = createService(voiceClient, state, new Date("2026-06-21T21:00:00.000Z"));

    const firstCall = await service.startNightlyReminder();
    const reminder = await state.getReminder("2026-06-21");
    const attempt = reminder?.attempts[0];

    expect(firstCall).toEqual({ placed: true });
    expect(voiceClient.calls).toHaveLength(1);
    expect(attempt).toBeDefined();

    await service.handleCallStatus({
      attemptId: attempt?.id,
      callSid: "CA000001",
      callStatus: "in-progress",
      date: "2026-06-21"
    });

    const duplicateCall = await service.startNightlyReminder();

    expect(duplicateCall).toEqual({ placed: false, reason: "already_answered" });
    expect(voiceClient.calls).toHaveLength(1);

    const nextNight = await service.startNightlyReminder(new Date("2026-06-22T21:00:00.000Z"));

    expect(nextNight).toEqual({ placed: true });
    expect(voiceClient.calls).toHaveLength(2);
  });

  it("schedules one retry two minutes after a no-answer status", async () => {
    const voiceClient = new FakeVoiceClient();
    const state = new MemoryReminderStateStore();
    const scheduledTimers: Array<{ callback: () => void; delayMs: number }> = [];
    const service = createService(voiceClient, state, new Date("2026-06-21T21:00:00.000Z"), {
      setTimeout: (callback, delayMs) => {
        scheduledTimers.push({ callback, delayMs });
        return scheduledTimers.length as unknown as NodeJS.Timeout;
      }
    });

    await service.startNightlyReminder();
    const firstReminder = await state.getReminder("2026-06-21");
    const firstAttempt = firstReminder?.attempts[0];

    await service.handleCallStatus({
      attemptId: firstAttempt?.id,
      callSid: "CA000001",
      callStatus: "no-answer",
      date: "2026-06-21"
    });

    expect(scheduledTimers).toHaveLength(1);
    expect(scheduledTimers[0]?.delayMs).toBe(120_000);

    scheduledTimers[0]?.callback();
    await flushPromises();

    const retriedReminder = await state.getReminder("2026-06-21");

    expect(voiceClient.calls).toHaveLength(2);
    expect(retriedReminder?.retry).toBeUndefined();
    expect(retriedReminder?.attempts).toHaveLength(2);
    expect(retriedReminder?.attempts[1]?.retryForAttemptId).toBe(firstAttempt?.id);
  });

  it("does not schedule more retries after the configured retry limit", async () => {
    const voiceClient = new FakeVoiceClient();
    const state = new MemoryReminderStateStore();
    const scheduledTimers: Array<{ callback: () => void; delayMs: number }> = [];
    const service = createService(voiceClient, state, new Date("2026-06-21T21:00:00.000Z"), {
      setTimeout: (callback, delayMs) => {
        scheduledTimers.push({ callback, delayMs });
        return scheduledTimers.length as unknown as NodeJS.Timeout;
      }
    });

    await service.startNightlyReminder();
    const firstAttempt = (await state.getReminder("2026-06-21"))?.attempts[0];
    await service.handleCallStatus({
      attemptId: firstAttempt?.id,
      callSid: "CA000001",
      callStatus: "no-answer",
      date: "2026-06-21"
    });

    scheduledTimers[0]?.callback();
    await flushPromises();

    const retryAttempt = (await state.getReminder("2026-06-21"))?.attempts[1];
    await service.handleCallStatus({
      attemptId: retryAttempt?.id,
      callSid: "CA000002",
      callStatus: "no-answer",
      date: "2026-06-21"
    });

    expect(voiceClient.calls).toHaveLength(2);
    expect(scheduledTimers).toHaveLength(1);
    expect((await state.getReminder("2026-06-21"))?.closedAt).toBeDefined();
  });
});

function createService(
  voiceClient: VoiceClient,
  state: ReminderStateRepository,
  now: Date,
  timerOverrides: Partial<Pick<ConstructorParameters<typeof ReminderService>[2], "setTimeout">> = {}
): ReminderService {
  return new ReminderService(voiceClient, state, {
    logger: {
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined
    },
    maxRetryAttempts: 1,
    now: () => now,
    reminderMessage: "Hi. This is your 9 PM reminder to do your red LED laser.",
    retryDelayMs: 120_000,
    timeZone: "UTC",
    ...timerOverrides
  });
}

class FakeVoiceClient implements VoiceClient {
  readonly calls: ReminderCallRequest[] = [];

  async placeReminderCall(request: ReminderCallRequest): Promise<ReminderCallResult> {
    this.calls.push(request);

    return { callSid: `CA${this.calls.length.toString().padStart(6, "0")}` };
  }
}

class MemoryReminderStateStore implements ReminderStateRepository {
  private readonly reminders = new Map<string, ReminderRecord>();

  async findAttemptByCallSid(callSid: string) {
    for (const [date, reminder] of this.reminders.entries()) {
      const attempt = reminder.attempts.find((item) => item.callSid === callSid);

      if (attempt) {
        return { date, attempt: structuredClone(attempt) };
      }
    }

    return undefined;
  }

  async getReminder(date: string): Promise<ReminderRecord | undefined> {
    const reminder = this.reminders.get(date);

    return reminder ? structuredClone(reminder) : undefined;
  }

  async listReminders(): Promise<ReminderRecord[]> {
    return [...this.reminders.values()].map((reminder) => structuredClone(reminder));
  }

  async updateReminder(
    date: string,
    updater: (record: ReminderRecord) => ReminderRecord | void
  ): Promise<ReminderRecord> {
    const current = this.reminders.get(date) ?? { date, attempts: [] };
    const draft = structuredClone(current);
    const next = updater(draft) ?? draft;

    this.reminders.set(date, structuredClone(next));

    return structuredClone(next);
  }
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
