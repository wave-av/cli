import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand, CapabilityUnavailableError } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

/**
 * `mesh status` / `mesh regions` called GET /v1/mesh/topology and /v1/mesh/regions. The mesh
 * coordinator behind /v1/mesh answers both with 400 {"error":"missing x-wave-node"} and, with that
 * header supplied, 404 {"error":"no such mesh route"}: neither route exists. 1.0.10 surfaced that as
 * an opaque "HTTP_400 Bad Request". Both stop before any network call until the routes are served.
 */
const MESH_READ_UNAVAILABLE =
  "is not available: the WAVE mesh coordinator does not serve this route yet. Nothing was sent.";

export function registerMeshCommands(program: Command): void {
  const mesh = program.command("mesh").description("Multi-region mesh network and failover");

  mesh
    .command("status")
    .description("Show mesh network status (not yet served by the API)")
    .action(
      wrapCommand(async () => {
        throw new CapabilityUnavailableError(`\`wave mesh status\` ${MESH_READ_UNAVAILABLE}`, "mesh");
      }),
    );

  mesh
    .command("regions")
    .description("List available mesh regions (not yet served by the API)")
    .action(
      wrapCommand(async () => {
        throw new CapabilityUnavailableError(`\`wave mesh regions\` ${MESH_READ_UNAVAILABLE}`, "mesh");
      }),
    );

  mesh
    .command("failover")
    .description("Trigger a failover to a target region under a failover policy")
    .requiredOption("--policy-id <policyId>", "Failover policy ID")
    .requiredOption("--to <region>", "Target region")
    .action(
      wrapCommand(async (opts) => {
        const confirmed = await confirmDestructive(
          "failover",
          `policy ${opts.policyId} to ${opts.to}`,
          program.opts(),
        );
        if (!confirmed) return;
        const client = await getClient(program.opts());
        // Failover is driven by a policy, which already names its source; only the
        // target region is supplied at trigger time.
        const result = await client.mesh.triggerFailover(opts.policyId, opts.to);
        console.log(chalk.green(`Failover initiated to ${opts.to}.`));
        formatOutput(result, program.opts());
      }),
    );
}
