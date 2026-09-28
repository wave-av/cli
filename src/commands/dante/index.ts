import { Command } from "commander";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import type { DanteObserveResult } from "./types.js";

/**
 * `wave dante observe` — Dante control-plane observation (`POST /v1/dante/observe`), a GA route
 * this platform's go-live definition names explicitly. A direct hit on the spoke worker
 * (dante-observe.wave.online) 403s with "request did not traverse the WAVE gateway" — this CLI
 * always goes through the public gateway (api.wave.online) via `getClient`, so that gate does not
 * apply here.
 */
export function registerDanteCommands(program: Command): void {
  const dante = program.command("dante").description("Dante audio-over-IP — control-plane observation");

  dante
    .command("observe")
    .description("Observe Dante control-plane state (POST /v1/dante/observe)")
    .option("--node <node>", "Dante node/device name to observe")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const body: Record<string, unknown> = {};
        if (opts.node) body.node = opts.node;
        const result = await client.client.post<DanteObserveResult>("/v1/dante/observe", body);
        formatOutput(result, program.opts());
      }),
    );
}
