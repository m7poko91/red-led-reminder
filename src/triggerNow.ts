import { createReminderRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const { reminderService } = createReminderRuntime();
  const result = await reminderService.startNightlyReminder();

  if (result.placed) {
    console.info("Sent a red LED reminder text.");
    return;
  }

  console.info(`No text sent: ${result.reason ?? "already handled"}.`);
}

main().catch((error: unknown) => {
  console.error("Failed to send red LED reminder text", error);
  process.exitCode = 1;
});
