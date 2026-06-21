import { loadConfig } from "./config.js";
import { ReminderService } from "./reminders/reminderService.js";
import { scheduleNightlyReminder } from "./scheduler/nightlyReminderScheduler.js";
import { createApp } from "./server.js";
import { FileReminderStateStore } from "./state/reminderState.js";
import { TwilioVoiceClient } from "./voice/twilioVoiceClient.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const stateStore = new FileReminderStateStore(config.stateFilePath);
  const voiceClient = new TwilioVoiceClient({
    accountSid: config.twilioAccountSid,
    authToken: config.twilioAuthToken,
    fromNumber: config.twilioFromNumber,
    targetNumber: config.targetPhoneNumber,
    webhookBaseUrl: config.webhookBaseUrl
  });
  const reminderService = new ReminderService(voiceClient, stateStore, {
    maxRetryAttempts: config.maxRetryAttempts,
    reminderMessage: config.reminderMessage,
    retryDelayMs: config.retryDelayMs,
    timeZone: config.timeZone
  });
  const app = createApp({
    reminderService,
    twilioAuthToken: config.twilioAuthToken,
    validateTwilioSignature: config.validateTwilioSignature,
    webhookBaseUrl: config.webhookBaseUrl
  });

  scheduleNightlyReminder(reminderService, {
    cronExpression: config.cronExpression,
    timeZone: config.timeZone
  });
  await reminderService.resumePendingRetries();

  app.listen(config.port, () => {
    console.info(`Red LED reminder service listening on port ${config.port}`);
    console.info(`Nightly reminder scheduled with '${config.cronExpression}' in ${config.timeZone}`);
  });
}

main().catch((error: unknown) => {
  console.error("Failed to start red LED reminder service", error);
  process.exitCode = 1;
});
