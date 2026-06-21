import twilio from "twilio";
import type { MessagingClient, ReminderMessageRequest, ReminderMessageResult } from "../reminders/types.js";

export interface TwilioSmsClientOptions {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  targetNumber: string;
  webhookBaseUrl: string;
}

export class TwilioSmsClient implements MessagingClient {
  private readonly client: ReturnType<typeof twilio>;
  private readonly fromNumber: string;
  private readonly targetNumber: string;
  private readonly webhookBaseUrl: string;

  constructor(options: TwilioSmsClientOptions) {
    this.client = twilio(options.accountSid, options.authToken);
    this.fromNumber = options.fromNumber;
    this.targetNumber = options.targetNumber;
    this.webhookBaseUrl = options.webhookBaseUrl.replace(/\/$/, "");
  }

  async sendReminderMessage(request: ReminderMessageRequest): Promise<ReminderMessageResult> {
    const message = await this.client.messages.create({
      body: `${request.message} Reply DONE when you complete it.`,
      from: this.fromNumber,
      statusCallback: this.createStatusCallbackUrl(request),
      to: this.targetNumber
    });

    return { messageSid: message.sid };
  }

  private createStatusCallbackUrl(request: ReminderMessageRequest): string {
    const url = new URL("/webhooks/twilio/message-status", this.webhookBaseUrl);
    url.searchParams.set("date", request.date);
    url.searchParams.set("attemptId", request.attemptId);

    return url.toString();
  }
}
