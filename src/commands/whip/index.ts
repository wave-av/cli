import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import type { WhipPublishResult } from "./types.js";

/**
 * `wave whip publish` — mints a WHIP publish session (`POST /v1/whip/publish`) and prints the
 * WHIP URL + bearer token in the shape OBS Studio's WHIP output needs (Settings > Stream >
 * Service: WHIP; Server: the WHIP URL; Bearer Token: the token).
 */
export function registerWhipCommands(program: Command): void {
  const whip = program.command("whip").description("WHIP — WebRTC-HTTP Ingestion Protocol publish sessions");

  whip
    .command("publish")
    .description("Mint a WHIP publish session (POST /v1/whip/publish); prints the URL + token for OBS")
    .option("--file <path>", "Local media file to publish")
    .option("--url <url>", "Source URL to publish")
    .action(
      wrapCommand(async (opts) => {
        if (!opts.file && !opts.url) {
          throw new Error("`wave whip publish` requires --file <path> or --url <url>");
        }
        if (opts.file && opts.url) {
          throw new Error("`wave whip publish` accepts only one of --file or --url, not both");
        }

        const client = await getClient(program.opts());
        const body: Record<string, unknown> = {};
        if (opts.file) body.file = opts.file;
        if (opts.url) body.url = opts.url;

        const result = await client.client.post<WhipPublishResult>("/v1/whip/publish", body);
        console.log(chalk.green("WHIP publish session created."));
        console.log(chalk.cyan(`WHIP URL: ${result.whipUrl}`));
        console.log(chalk.cyan(`Token:    ${result.token}`));
        console.log(chalk.dim("OBS Studio: Settings > Stream > Service: WHIP > Server: the WHIP URL above,"));
        console.log(chalk.dim("Bearer Token: the token above."));
        formatOutput(result, program.opts());
      }),
    );
}
