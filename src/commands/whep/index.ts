import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import type { WhepSubscribeResult } from "./types.js";

/**
 * `wave whep subscribe` — mints a WHEP subscribe session (`POST /v1/whep/subscribe`) for a
 * resource created upstream (e.g. an SRT input id or a WHIP publish session id).
 */
export function registerWhepCommands(program: Command): void {
  const whep = program.command("whep").description("WHEP — WebRTC-HTTP Egress Protocol subscribe sessions");

  whep
    .command("subscribe")
    .description("Mint a WHEP subscribe session (POST /v1/whep/subscribe)")
    .requiredOption("--id <id>", "Resource id to subscribe to (e.g. an SRT input id or WHIP session id)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.client.post<WhepSubscribeResult>("/v1/whep/subscribe", { id: opts.id });
        console.log(chalk.green("WHEP subscribe session created."));
        console.log(chalk.cyan(`WHEP URL: ${result.whepUrl}`));
        formatOutput(result, program.opts());
      }),
    );
}
