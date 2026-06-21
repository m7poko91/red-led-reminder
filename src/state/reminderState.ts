import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type {
  ReminderAttempt,
  ReminderRecord,
  ReminderStateData,
  ReminderStateRepository
} from "../reminders/types.js";

const attemptSchema = z.object({
  id: z.string(),
  messageSid: z.string().optional(),
  status: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  acknowledgedAt: z.string().optional(),
  completedAt: z.string().optional(),
  retryForAttemptId: z.string().optional()
});

const reminderSchema = z.object({
  date: z.string(),
  acknowledgedAt: z.string().optional(),
  closedAt: z.string().optional(),
  retry: z
    .object({
      dueAt: z.string(),
      afterAttemptId: z.string()
    })
    .optional(),
  attempts: z.array(attemptSchema)
});

const stateSchema = z.object({
  version: z.literal(1),
  reminders: z.record(z.string(), reminderSchema)
});

export class FileReminderStateStore implements ReminderStateRepository {
  private readonly filePath: string;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async findAttemptByMessageSid(
    messageSid: string
  ): Promise<{ date: string; attempt: ReminderAttempt } | undefined> {
    const state = await this.readState();

    for (const [date, reminder] of Object.entries(state.reminders)) {
      const attempt = reminder.attempts.find((item) => item.messageSid === messageSid);

      if (attempt) {
        return { date, attempt: clone(attempt) };
      }
    }

    return undefined;
  }

  async getReminder(date: string): Promise<ReminderRecord | undefined> {
    const state = await this.readState();
    const reminder = state.reminders[date];

    return reminder ? clone(reminder) : undefined;
  }

  async listReminders(): Promise<ReminderRecord[]> {
    const state = await this.readState();

    return Object.values(state.reminders).map((reminder) => clone(reminder));
  }

  async updateReminder(
    date: string,
    updater: (record: ReminderRecord) => ReminderRecord | void
  ): Promise<ReminderRecord> {
    return this.withLock(async () => {
      const state = await this.readState();
      const current = state.reminders[date] ?? { date, attempts: [] };
      const draft = clone(current);
      const next = updater(draft) ?? draft;

      state.reminders[date] = next;
      await this.writeState(state);

      return clone(next);
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const nextOperation = this.operationQueue.then(operation, operation);
    this.operationQueue = nextOperation.catch(() => undefined);

    return nextOperation;
  }

  private async readState(): Promise<ReminderStateData> {
    try {
      const raw = await readFile(this.filePath, "utf8");

      return stateSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissingFile(error)) {
        return { version: 1, reminders: {} };
      }

      throw error;
    }
  }

  private async writeState(state: ReminderStateData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
