import { createReminderRuntime } from "./runtime.js";
import { scheduleNightlyReminder } from "./scheduler/nightlyReminderScheduler.js";
import { createApp } from "./server.js";

async function main(): Promise<void> {
  const { config, reminderService } = createReminderRuntime();
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
