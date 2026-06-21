import { createReminderRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const { reminderService } = createReminderRuntime();
  const result = await reminderService.startNightlyReminder();

  if (result.placed) {
    console.info("Placed a red LED reminder call.");
    return;
  }

  console.info(`No call placed: ${result.reason ?? "already handled"}.`);
}

main().catch((error: unknown) => {
  console.error("Failed to place red LED reminder call", error);
  process.exitCode = 1;
});
