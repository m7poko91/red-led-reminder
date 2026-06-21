export type ReminderCallStatus =
  | "created"
  | "queued"
  | "initiated"
  | "ringing"
  | "in-progress"
  | "answered"
  | "completed"
  | "no-answer"
  | "busy"
  | "failed"
  | "canceled";

export interface ReminderAttempt {
  id: string;
  callSid?: string;
  status: ReminderCallStatus | string;
  startedAt: string;
  updatedAt: string;
  answeredAt?: string;
  completedAt?: string;
  retryForAttemptId?: string;
}

export interface ScheduledRetry {
  dueAt: string;
  afterAttemptId: string;
}

export interface ReminderRecord {
  date: string;
  answeredAt?: string;
  closedAt?: string;
  retry?: ScheduledRetry;
  attempts: ReminderAttempt[];
}

export interface ReminderStateData {
  version: 1;
  reminders: Record<string, ReminderRecord>;
}

export interface ReminderStateRepository {
  findAttemptByCallSid(callSid: string): Promise<{ date: string; attempt: ReminderAttempt } | undefined>;
  getReminder(date: string): Promise<ReminderRecord | undefined>;
  listReminders(): Promise<ReminderRecord[]>;
  updateReminder(
    date: string,
    updater: (record: ReminderRecord) => ReminderRecord | void
  ): Promise<ReminderRecord>;
}

export interface ReminderCallRequest {
  attemptId: string;
  date: string;
  message: string;
}

export interface ReminderCallResult {
  callSid: string;
}

export interface VoiceClient {
  placeReminderCall(request: ReminderCallRequest): Promise<ReminderCallResult>;
}

export interface ReminderStatusCallback {
  attemptId?: string;
  callSid: string;
  callStatus: string;
  date?: string;
}
