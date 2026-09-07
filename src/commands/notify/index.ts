import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { optionalOneOf } from "../../lib/options.js";

/**
 * The SDK's NotificationsAPI is an inbox (list/get/read-state/preferences), not a
 * send/template/channel-management service. There is no send(), templates.*, or
 * channels.* surface to call — those commands previously called methods that never
 * existed. Reconciled to the real inbox-style API below.
 */
export function registerNotifyCommands(program: Command): void {
  const notify = program.command("notify").description("Notification management");

  notify
    .command("list")
    .description("List notifications")
    .option("--status <status>", "Filter by status (unread, read, archived)")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.notifications.list({
          status: optionalOneOf("--status", opts.status, ["unread", "read", "archived"] as const),
          limit: parseInt(opts.limit, 10),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  notify
    .command("get <id>")
    .description("Get a notification")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.notifications.get(id);
        formatOutput(result, program.opts());
      }),
    );

  notify
    .command("read <id>")
    .description("Mark a notification as read")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.notifications.markAsRead(id);
        console.log(chalk.green(`Notification ${id} marked read.`));
        formatOutput(result, program.opts());
      }),
    );

  notify
    .command("read-all")
    .description("Mark all notifications as read")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.notifications.markAllRead();
        console.log(chalk.green(`${result.updated} notification(s) marked read.`));
      }),
    );

  notify
    .command("archive <id>")
    .description("Archive a notification")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.notifications.archive(id);
        console.log(chalk.green(`Notification ${id} archived.`));
        formatOutput(result, program.opts());
      }),
    );

  notify
    .command("remove <id>")
    .description("Delete a notification")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        await client.notifications.remove(id);
        console.log(chalk.green(`Notification ${id} deleted.`));
      }),
    );

  notify
    .command("unread-count")
    .description("Get the unread notification count")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.notifications.getUnreadCount();
        formatOutput(result, program.opts());
      }),
    );

  const preferences = notify.command("preferences").description("Manage notification preferences");

  preferences
    .command("get")
    .description("Get notification preferences")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.notifications.getPreferences();
        formatOutput(result, program.opts());
      }),
    );

  preferences
    .command("update")
    .description("Update notification preferences")
    .option("--digest-frequency <frequency>", "realtime, hourly, daily, or weekly")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.notifications.updatePreferences({
          digest_frequency: optionalOneOf("--digest-frequency", opts.digestFrequency, [
            "realtime",
            "hourly",
            "daily",
            "weekly",
          ] as const),
        });
        console.log(chalk.green("Preferences updated."));
        formatOutput(result, program.opts());
      }),
    );
}
