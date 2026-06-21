import twilio from "twilio";
import type { ReminderCallRequest, ReminderCallResult, VoiceClient } from "../reminders/types.js";

export interface TwilioVoiceClientOptions {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  targetNumber: string;
  webhookBaseUrl: string;
}

export class TwilioVoiceClient implements VoiceClient {
  private readonly client: ReturnType<typeof twilio>;
  private readonly fromNumber: string;
  private readonly targetNumber: string;
  private readonly webhookBaseUrl: string;

  constructor(options: TwilioVoiceClientOptions) {
    this.client = twilio(options.accountSid, options.authToken);
    this.fromNumber = options.fromNumber;
    this.targetNumber = options.targetNumber;
    this.webhookBaseUrl = options.webhookBaseUrl.replace(/\/$/, "");
  }

  async placeReminderCall(request: ReminderCallRequest): Promise<ReminderCallResult> {
    const response = new twilio.twiml.VoiceResponse();
    response.say(
      {
        voice: "alice"
      },
      request.message
    );

    const call = await this.client.calls.create({
      from: this.fromNumber,
      statusCallback: this.createStatusCallbackUrl(request),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      to: this.targetNumber,
      twiml: response.toString()
    });

    return { callSid: call.sid };
  }

  private createStatusCallbackUrl(request: ReminderCallRequest): string {
    const url = new URL("/webhooks/twilio/call-status", this.webhookBaseUrl);
    url.searchParams.set("date", request.date);
    url.searchParams.set("attemptId", request.attemptId);

    return url.toString();
  }
}
