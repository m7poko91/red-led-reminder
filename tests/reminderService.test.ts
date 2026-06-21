import { describe, expect, it } from "vitest";
import { ReminderService } from "../src/reminders/reminderService.js";
import type {
  MessagingClient,
  ReminderMessageRequest,
  ReminderMessageResult,
  ReminderRecord,
  ReminderStateRepository
} from "../src/reminders/types.js";

describe("ReminderService", () => {
  it("sends one nightly text and suppresses additional texts after DONE is received", async () => {
    const messagingClient = new FakeMessagingClient();
    const state = new MemoryReminderStateStore();
    const service = createService(messagingClient, state, new Date("2026-06-21T21:00:00.000Z"));

    const firstText = await service.startNightlyReminder();
    const reminder = await state.getReminder("2026-06-21");

    expect(firstText).toEqual({ placed: true });
    expect(messagingClient.messages).toHaveLength(1);
    expect(reminder?.attempts[0]).toBeDefined();

    await service.handleIncomingMessage({
      body: "DONE",
      from: "+18473442559",
      messageSid: "SM_INBOUND"
    });

    const duplicateText = await service.startNightlyReminder();

    expect(duplicateText).toEqual({ placed: false, reason: "already_acknowledged" });
    expect(messagingClient.messages).toHaveLength(1);

    const nextNight = await service.startNightlyReminder(new Date("2026-06-22T21:00:00.000Z"));

    expect(nextNight).toEqual({ placed: true });
    expect(messagingClient.messages).toHaveLength(2);
  });

  it("schedules one retry two minutes after an unacknowledged text", async () => {
    const messagingClient = new FakeMessagingClient();
    const state = new MemoryReminderStateStore();
    let now = new Date("2026-06-21T21:00:00.000Z");
    const scheduledTimers: Array<{ callback: () => void; delayMs: number }> = [];
    const service = createService(messagingClient, state, () => now, {
      setTimeout: (callback, delayMs) => {
        scheduledTimers.push({ callback, delayMs });
        return scheduledTimers.length as unknown as NodeJS.Timeout;
      }
    });

    await service.startNightlyReminder();

    expect(scheduledTimers).toHaveLength(1);
    expect(scheduledTimers[0]?.delayMs).toBe(120_000);

    now = new Date("2026-06-21T21:02:00.000Z");
    scheduledTimers[0]?.callback();
    await flushPromises();

    const retriedReminder = await state.getReminder("2026-06-21");

    expect(messagingClient.messages).toHaveLength(2);
    expect(retriedReminder?.retry).toBeUndefined();
    expect(retriedReminder?.attempts).toHaveLength(2);
    expect(retriedReminder?.attempts[1]?.retryForAttemptId).toBe(retriedReminder?.attempts[0]?.id);
  });

  it("cancels the retry when a DONE reply arrives before the retry fires", async () => {
    const messagingClient = new FakeMessagingClient();
    const state = new MemoryReminderStateStore();
    let now = new Date("2026-06-21T21:00:00.000Z");
    const scheduledTimers: Array<{ callback: () => void; delayMs: number }> = [];
    const clearedTimers: NodeJS.Timeout[] = [];
    const service = createService(messagingClient, state, () => now, {
      clearTimeout: (timer) => {
        clearedTimers.push(timer);
      },
      setTimeout: (callback, delayMs) => {
        scheduledTimers.push({ callback, delayMs });
        return scheduledTimers.length as unknown as NodeJS.Timeout;
      }
    });

    await service.startNightlyReminder();
    await service.handleIncomingMessage({ body: "ok" });

    now = new Date("2026-06-21T21:02:00.000Z");
    scheduledTimers[0]?.callback();
    await flushPromises();

    expect(clearedTimers).toHaveLength(1);
    expect(messagingClient.messages).toHaveLength(1);
    expect((await state.getReminder("2026-06-21"))?.acknowledgedAt).toBeDefined();
  });

  it("does not schedule more retries after the configured retry limit", async () => {
    const messagingClient = new FakeMessagingClient();
    const state = new MemoryReminderStateStore();
    let now = new Date("2026-06-21T21:00:00.000Z");
    const scheduledTimers: Array<{ callback: () => void; delayMs: number }> = [];
    const service = createService(messagingClient, state, () => now, {
      setTimeout: (callback, delayMs) => {
        scheduledTimers.push({ callback, delayMs });
        return scheduledTimers.length as unknown as NodeJS.Timeout;
      }
    });

    await service.startNightlyReminder();

    now = new Date("2026-06-21T21:02:00.000Z");
    scheduledTimers[0]?.callback();
    await flushPromises();

    expect(messagingClient.messages).toHaveLength(2);
    expect(scheduledTimers).toHaveLength(1);
    expect((await state.getReminder("2026-06-21"))?.closedAt).toBeDefined();
  });
});

function createService(
  messagingClient: MessagingClient,
  state: ReminderStateRepository,
  now: Date | (() => Date),
  timerOverrides: Partial<
    Pick<ConstructorParameters<typeof ReminderService>[2], "clearTimeout" | "setTimeout">
  > = {}
): ReminderService {
  return new ReminderService(messagingClient, state, {
    logger: {
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined
    },
    maxRetryAttempts: 1,
    now: typeof now === "function" ? now : () => now,
    reminderMessage: "Hi. This is your 9 PM reminder to do your red LED laser.",
    retryDelayMs: 120_000,
    timeZone: "UTC",
    ...timerOverrides
  });
}

class FakeMessagingClient implements MessagingClient {
  readonly messages: ReminderMessageRequest[] = [];

  async sendReminderMessage(request: ReminderMessageRequest): Promise<ReminderMessageResult> {
    this.messages.push(request);

    return { messageSid: `SM${this.messages.length.toString().padStart(6, "0")}` };
  }
}

class MemoryReminderStateStore implements ReminderStateRepository {
  private readonly reminders = new Map<string, ReminderRecord>();

  async findAttemptByMessageSid(messageSid: string) {
    for (const [date, reminder] of this.reminders.entries()) {
      const attempt = reminder.attempts.find((item) => item.messageSid === messageSid);

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
