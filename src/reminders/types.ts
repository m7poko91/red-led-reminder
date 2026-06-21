export type ReminderMessageStatus =
  | "created"
  | "queued"
  | "accepted"
  | "scheduled"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "acknowledged";

export interface ReminderAttempt {
  id: string;
  messageSid?: string;
  status: ReminderMessageStatus | string;
  startedAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  completedAt?: string;
  retryForAttemptId?: string;
}

export interface ScheduledRetry {
  dueAt: string;
  afterAttemptId: string;
}

export interface ReminderRecord {
  date: string;
  acknowledgedAt?: string;
  closedAt?: string;
  retry?: ScheduledRetry;
  attempts: ReminderAttempt[];
}

export interface ReminderStateData {
  version: 1;
  reminders: Record<string, ReminderRecord>;
}

export interface ReminderStateRepository {
  findAttemptByMessageSid(messageSid: string): Promise<{ date: string; attempt: ReminderAttempt } | undefined>;
  getReminder(date: string): Promise<ReminderRecord | undefined>;
  listReminders(): Promise<ReminderRecord[]>;
  updateReminder(
    date: string,
    updater: (record: ReminderRecord) => ReminderRecord | void
  ): Promise<ReminderRecord>;
}

export interface ReminderMessageRequest {
  attemptId: string;
  date: string;
  message: string;
}

export interface ReminderMessageResult {
  messageSid: string;
}

export interface MessagingClient {
  sendReminderMessage(request: ReminderMessageRequest): Promise<ReminderMessageResult>;
}

export interface ReminderMessageStatusCallback {
  attemptId?: string;
  messageSid: string;
  messageStatus: string;
  date?: string;
}

export interface IncomingReminderMessage {
  body: string;
  from?: string;
  messageSid?: string;
}
