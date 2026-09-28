import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import type { MoqToken } from "./types.js";

/**
 * `wave moq token publish|subscribe` — mints a MoQ session token against the GA route
 * `POST /v1/moq/publish/:ns/:track` (this lane's go-live definition names the publish route
 * explicitly; subscribe mirrors it at `/v1/moq/subscribe/:ns/:track`).
 */
export function registerMoqCommands(program: Command): void {
  const moq = program.command("moq").description("MoQ (Media over QUIC) — mint publish/subscribe tokens");
  const token = moq.command("token").description("Mint MoQ session tokens");

  token
    .command("publish")
    .description("Mint a MoQ publish token (POST /v1/moq/publish/:ns/:track)")
    .requiredOption("--ns <namespace>", "MoQ namespace")
    .requiredOption("--track <track>", "MoQ track name")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const path = `/v1/moq/publish/${encodeURIComponent(opts.ns)}/${encodeURIComponent(opts.track)}`;
        const result = await client.client.post<MoqToken>(path);
        console.log(chalk.green(`MoQ publish token minted for ${opts.ns}/${opts.track}`));
        formatOutput(result, program.opts());
      }),
    );

  token
    .command("subscribe")
    .description("Mint a MoQ subscribe token (POST /v1/moq/subscribe/:ns/:track)")
    .requiredOption("--ns <namespace>", "MoQ namespace")
    .requiredOption("--track <track>", "MoQ track name")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const path = `/v1/moq/subscribe/${encodeURIComponent(opts.ns)}/${encodeURIComponent(opts.track)}`;
        const result = await client.client.post<MoqToken>(path);
        console.log(chalk.green(`MoQ subscribe token minted for ${opts.ns}/${opts.track}`));
        formatOutput(result, program.opts());
      }),
    );
}
