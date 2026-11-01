import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import type { CrestSession, CrestSessionListResponse } from "./types.js";

/**
 * `wave crest sessions *` — Crest (MoQ browser player) sessions, one of the GA transport routes
 * this platform's go-live definition names (`/v1/crest/sessions`). No dedicated `crest` SDK
 * module exists yet; reached through the SDK's already-published generic client, same pattern as
 * `wave srt`/`wave moq`/`wave whip`/`wave whep`.
 */
export function registerCrestCommands(program: Command): void {
  const crest = program.command("crest").description("Crest — MoQ browser player sessions");
  const sessions = crest.command("sessions").description("Manage Crest sessions");

  sessions
    .command("create")
    .description("Create a Crest session (POST /v1/crest/sessions)")
    .requiredOption("--title <title>", "Session title")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.client.post<CrestSession>("/v1/crest/sessions", { title: opts.title });
        console.log(chalk.green(`Crest session created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  sessions
    .command("list")
    .description("List Crest sessions (GET /v1/crest/sessions)")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.client.get<CrestSessionListResponse>("/v1/crest/sessions", {
          params: { limit: Number(opts.limit) },
        });
        formatOutput(result.data, program.opts());
      }),
    );

  sessions
    .command("get <id>")
    .description("Get a Crest session (GET /v1/crest/sessions/:id)")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.client.get<CrestSession>(`/v1/crest/sessions/${encodeURIComponent(id)}`);
        formatOutput(result, program.opts());
      }),
    );
}
