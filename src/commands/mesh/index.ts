import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerMeshCommands(program: Command): void {
  const mesh = program.command("mesh").description("Multi-region mesh network and failover");

  mesh
    .command("status")
    .description("Show mesh network status")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.mesh.getTopology();
        formatOutput(result, program.opts());
      }),
    );

  mesh
    .command("regions")
    .description("List available mesh regions")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.mesh.listRegions();
        formatOutput(result.data, program.opts());
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
