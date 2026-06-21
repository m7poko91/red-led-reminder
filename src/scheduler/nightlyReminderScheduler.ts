import cron from "node-cron";
import type { ReminderService } from "../reminders/reminderService.js";

export interface NightlyReminderScheduleOptions {
  cronExpression: string;
  timeZone: string;
}

export function scheduleNightlyReminder(
  reminderService: ReminderService,
  options: NightlyReminderScheduleOptions
): cron.ScheduledTask {
  if (!cron.validate(options.cronExpression)) {
    throw new Error(`Invalid reminder cron expression: ${options.cronExpression}`);
  }

  return cron.schedule(
    options.cronExpression,
    () => {
      reminderService.startNightlyReminder().catch((error: unknown) => {
        console.error("Failed to start nightly red LED reminder", error);
      });
    },
    {
      timezone: options.timeZone
    }
  );
}
