import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerCollabCommands(program: Command): void {
  const collab = program.command("collab").description("Real-time collaboration rooms");

  const room = collab.command("room").description("Manage collaboration rooms");

  room
    .command("create")
    .description("Create a collaboration room")
    .option("--name <name>", "Room name")
    .option("--max-participants <n>", "Maximum participants", "50")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.collab.rooms.create({
          name: opts.name,
          maxParticipants: parseInt(opts.maxParticipants),
        });
        console.log(chalk.green(`Room created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  room
    .command("list")
    .description("List collaboration rooms")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.collab.rooms.list({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  room
    .command("join <id>")
    .description("Join a collaboration room")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.collab.rooms.join(id);
        console.log(chalk.green(`Joined room ${id}.`));
        formatOutput(result, program.opts());
      }),
    );

  collab
    .command("invite")
    .description("Invite a user to a collaboration room")
    .requiredOption("--room-id <roomId>", "Room ID")
    .requiredOption("--email <email>", "Email address to invite")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.collab.invite({
          roomId: opts.roomId,
          email: opts.email,
        });
        console.log(chalk.green(`Invitation sent to ${opts.email}.`));
        formatOutput(result, program.opts());
      }),
    );
}
