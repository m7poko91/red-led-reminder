import "dotenv/config";
import { z } from "zod";

export interface AppConfig {
  cronExpression: string;
  maxRetryAttempts: number;
  port: number;
  reminderMessage: string;
  retryDelayMs: number;
  stateFilePath: string;
  targetPhoneNumber: string;
  timeZone: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  validateTwilioSignature: boolean;
  webhookBaseUrl: string;
}

const envSchema = z.object({
  MAX_RETRY_ATTEMPTS: z.coerce.number().int().min(0).default(1),
  PORT: z.coerce.number().int().positive().default(3000),
  REMINDER_CRON_EXPRESSION: z.string().default("0 21 * * *"),
  REMINDER_MESSAGE: z.string().default("Hi. This is your 9 PM reminder to do your red LED laser."),
  REMINDER_TIMEZONE: z.string().default(process.env.TZ ?? "UTC"),
  RETRY_DELAY_MS: z.coerce.number().int().positive().default(120_000),
  STATE_FILE_PATH: z.string().default("./data/reminder-state.json"),
  TARGET_PHONE_NUMBER: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_FROM_NUMBER: z.string().min(1),
  TWILIO_VALIDATE_WEBHOOK_SIGNATURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WEBHOOK_BASE_URL: z.string().url()
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    cronExpression: parsed.REMINDER_CRON_EXPRESSION,
    maxRetryAttempts: parsed.MAX_RETRY_ATTEMPTS,
    port: parsed.PORT,
    reminderMessage: parsed.REMINDER_MESSAGE,
    retryDelayMs: parsed.RETRY_DELAY_MS,
    stateFilePath: parsed.STATE_FILE_PATH,
    targetPhoneNumber: parsed.TARGET_PHONE_NUMBER,
    timeZone: parsed.REMINDER_TIMEZONE,
    twilioAccountSid: parsed.TWILIO_ACCOUNT_SID,
    twilioAuthToken: parsed.TWILIO_AUTH_TOKEN,
    twilioFromNumber: parsed.TWILIO_FROM_NUMBER,
    validateTwilioSignature: parsed.TWILIO_VALIDATE_WEBHOOK_SIGNATURE,
    webhookBaseUrl: parsed.WEBHOOK_BASE_URL
  };
}
