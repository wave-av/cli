import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";

export function registerCollabCommands(program: Command): void {
  const collab = program.command("collab").description("Real-time collaboration rooms");

  const room = collab.command("room").description("Manage collaboration rooms");

  room
    .command("create")
    .description("Create a collaboration room")
    .requiredOption("--name <name>", "Room name")
    .requiredOption(
      "--resource-type <type>",
      "Resource the room is about (project, clip, document, stream)",
    )
    .requiredOption("--resource-id <id>", "ID of that resource")
    .option("--max-participants <n>", "Maximum participants", "50")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.collab.createRoom({
          name: opts.name,
          resource_type: oneOf("--resource-type", opts.resourceType, [
            "project",
            "clip",
            "document",
            "stream",
          ]),
          resource_id: opts.resourceId,
          max_participants: parseInt(opts.maxParticipants),
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
        const result = await client.collab.listRooms({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  room
    .command("join <id>")
    .description("Get a join token for a collaboration room")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        // Joining is client-side; the API issues a scoped token for the room.
        const result = await client.collab.getJoinToken(id);
        console.log(chalk.green(`Join token issued for room ${id}.`));
        formatOutput(result, program.opts());
      }),
    );

  collab
    .command("invite")
    .description("Invite a user to a collaboration room")
    .requiredOption("--room-id <roomId>", "Room ID")
    .requiredOption("--email <email>", "Email address to invite")
    .option("--role <role>", "Participant role (owner, editor, commenter, viewer)", "viewer")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.collab.invite(opts.roomId, [
          {
            email: opts.email,
            role: oneOf("--role", opts.role, ["owner", "editor", "commenter", "viewer"]),
          },
        ]);
        console.log(chalk.green(`Invitation sent to ${opts.email}.`));
        formatOutput(result, program.opts());
      }),
    );
}
