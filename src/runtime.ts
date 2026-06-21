import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { TwilioSmsClient } from "./messaging/twilioSmsClient.js";
import { ReminderService } from "./reminders/reminderService.js";
import { FileReminderStateStore } from "./state/reminderState.js";

export interface ReminderRuntime {
  config: AppConfig;
  reminderService: ReminderService;
}

export function createReminderRuntime(env: NodeJS.ProcessEnv = process.env): ReminderRuntime {
  const config = loadConfig(env);
  const stateStore = new FileReminderStateStore(config.stateFilePath);
  const messagingClient = new TwilioSmsClient({
    accountSid: config.twilioAccountSid,
    authToken: config.twilioAuthToken,
    fromNumber: config.twilioFromNumber,
    targetNumber: config.targetPhoneNumber,
    webhookBaseUrl: config.webhookBaseUrl
  });
  const reminderService = new ReminderService(messagingClient, stateStore, {
    maxRetryAttempts: config.maxRetryAttempts,
    reminderMessage: config.reminderMessage,
    retryDelayMs: config.retryDelayMs,
    timeZone: config.timeZone
  });

  return {
    config,
    reminderService
  };
}
