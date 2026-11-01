import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";
import type { SrtInput, SrtInputListResponse } from "./types.js";

/**
 * `wave srt inputs *` — SRT ingest, one of the GA transport routes this go-live lane proves
 * (`POST /v1/srt/inputs`, verified served and priced by the readiness audit, unlike
 * `/v1/streams`/`/v1/phone`; see `wave stream`/`wave phone` for the preview conversions of those).
 */
export function registerSrtCommands(program: Command): void {
  const srt = program
    .command("srt")
    .description("SRT ingest — publish an SRT input to WAVE");

  const inputs = srt.command("inputs").description("Manage SRT inputs");

  inputs
    .command("create")
    .description("Create an SRT input and mint its ingest URL (POST /v1/srt/inputs)")
    .requiredOption("--title <title>", "Input title")
    .option("--passphrase <passphrase>", "SRT passphrase (min 10 chars) for encrypted ingest")
    .option("--latency-ms <ms>", "SRT latency in milliseconds", "200")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const body: Record<string, unknown> = {
          title: opts.title,
          latencyMs: Number(opts.latencyMs),
        };
        if (opts.passphrase) body.passphrase = opts.passphrase;

        const result = await client.client.post<SrtInput>("/v1/srt/inputs", body);
        console.log(chalk.green(`SRT input created: ${result.id}`));
        console.log(chalk.cyan(`SRT URL: ${result.srtUrl}`));
        formatOutput(result, program.opts());
      }),
    );

  inputs
    .command("list")
    .description("List SRT inputs (GET /v1/srt/inputs)")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.client.get<SrtInputListResponse>("/v1/srt/inputs", {
          params: { limit: Number(opts.limit) },
        });
        formatOutput(result.data, program.opts());
      }),
    );

  inputs
    .command("get <id>")
    .description("Get an SRT input (GET /v1/srt/inputs/:id)")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.client.get<SrtInput>(`/v1/srt/inputs/${encodeURIComponent(id)}`);
        formatOutput(result, program.opts());
      }),
    );

  inputs
    .command("delete <id>")
    .description("Delete an SRT input (DELETE /v1/srt/inputs/:id)")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("delete", `SRT input ${id}`, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        await client.client.delete(`/v1/srt/inputs/${encodeURIComponent(id)}`);
        console.log(chalk.green(`SRT input ${id} deleted.`));
      }),
    );
}
