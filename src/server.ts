import express, { type NextFunction, type Request, type Response } from "express";
import twilio from "twilio";
import type { ReminderService } from "./reminders/reminderService.js";

export interface CreateAppOptions {
  reminderService: ReminderService;
  twilioAuthToken: string;
  validateTwilioSignature: boolean;
  webhookBaseUrl: string;
}

export function createApp(options: CreateAppOptions): express.Express {
  const app = express();

  app.get("/health", (_request: Request, response: Response) => {
    response.json({ ok: true });
  });

  app.post(
    "/webhooks/twilio/message-status",
    express.urlencoded({ extended: false }),
    validateTwilioRequest(options),
    async (request: Request, response: Response) => {
      const messageSid = getString(request.body.MessageSid ?? request.body.SmsSid ?? request.body.messageSid);
      const messageStatus = getString(request.body.MessageStatus ?? request.body.SmsStatus ?? request.body.messageStatus);

      if (!messageSid || !messageStatus) {
        response.status(400).json({ error: "MessageSid and MessageStatus are required" });
        return;
      }

      await options.reminderService.handleMessageStatus({
        attemptId: getString(request.query.attemptId),
        messageSid,
        messageStatus,
        date: getString(request.query.date)
      });

      response.status(204).send();
    }
  );

  app.post(
    "/webhooks/twilio/incoming-message",
    express.urlencoded({ extended: false }),
    validateTwilioRequest(options),
    async (request: Request, response: Response) => {
      const body = getString(request.body.Body ?? request.body.body);
      const twiml = new twilio.twiml.MessagingResponse();

      if (!body) {
        response.status(400).json({ error: "Body is required" });
        return;
      }

      const result = await options.reminderService.handleIncomingMessage({
        body,
        from: getString(request.body.From ?? request.body.from),
        messageSid: getString(request.body.MessageSid ?? request.body.SmsSid ?? request.body.messageSid)
      });

      if (result.acknowledged) {
        twiml.message("Got it. I will remind you again tomorrow night.");
      }

      response.type("text/xml").send(twiml.toString());
    }
  );

  return app;
}

function validateTwilioRequest(options: CreateAppOptions) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!options.validateTwilioSignature) {
      next();
      return;
    }

    const signature = request.header("X-Twilio-Signature") ?? "";
    const publicUrl = `${options.webhookBaseUrl.replace(/\/$/, "")}${request.originalUrl}`;
    const isValid = twilio.validateRequest(options.twilioAuthToken, signature, publicUrl, request.body);

    if (!isValid) {
      response.status(403).json({ error: "Invalid Twilio signature" });
      return;
    }

    next();
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
