import express, { type Request, type Response } from "express";
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
    "/webhooks/twilio/call-status",
    express.urlencoded({ extended: false }),
    (request: Request, response: Response, next) => {
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
    },
    async (request: Request, response: Response) => {
      const callSid = getString(request.body.CallSid ?? request.body.callSid);
      const callStatus = getString(request.body.CallStatus ?? request.body.callStatus);

      if (!callSid || !callStatus) {
        response.status(400).json({ error: "CallSid and CallStatus are required" });
        return;
      }

      await options.reminderService.handleCallStatus({
        attemptId: getString(request.query.attemptId),
        callSid,
        callStatus,
        date: getString(request.query.date)
      });

      response.status(204).send();
    }
  );

  return app;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
