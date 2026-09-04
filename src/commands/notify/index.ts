import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerNotifyCommands(program: Command): void {
  const notify = program.command("notify").description("Notification management");

  notify
    .command("send")
    .description("Send a notification")
    .requiredOption("--to <userId>", "Recipient user ID")
    .requiredOption("--template <templateId>", "Notification template ID")
    .option("--data <json>", "JSON data for template variables")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const data = opts.data ? JSON.parse(opts.data as string) : undefined;
        const result = await client.notifications.send({
          to: opts.to,
          template: opts.template,
          data,
        });
        console.log(chalk.green("Notification sent."));
        formatOutput(result, program.opts());
      }),
    );

  const templates = notify.command("templates").description("Manage notification templates");

  templates
    .command("list")
    .description("List notification templates")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.notifications.templates.list({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  templates
    .command("get <id>")
    .description("Get a notification template")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.notifications.templates.get(id);
        formatOutput(result, program.opts());
      }),
    );

  templates
    .command("create")
    .description("Create a notification template")
    .requiredOption("--name <name>", "Template name")
    .requiredOption("--body <body>", "Template body")
    .option("--subject <subject>", "Template subject (for email)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.notifications.templates.create({
          name: opts.name,
          body: opts.body,
          subject: opts.subject,
        });
        console.log(chalk.green(`Template created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  const channels = notify.command("channels").description("Manage notification channels");

  channels
    .command("list")
    .description("List notification channels")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.notifications.channels.list();
        formatOutput(result.data, program.opts());
      }),
    );
}
