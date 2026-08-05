import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/output/index.js";

export function registerDrmCommands(program: Command): void {
  const drm = program.command("drm").description("Digital rights management");

  // Licenses
  const licenses = drm.command("licenses").description("Manage DRM licenses");

  licenses
    .command("list")
    .description("List DRM licenses")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.drm.licenses.list({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  licenses
    .command("create")
    .description("Create a DRM license")
    .requiredOption("--content-id <contentId>", "Content ID")
    .requiredOption("--policy-id <policyId>", "Policy ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.drm.licenses.create({
          contentId: opts.contentId,
          policyId: opts.policyId,
        });
        console.log(chalk.green(`License created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  licenses
    .command("revoke <id>")
    .description("Revoke a DRM license")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("revoke", `license ${id}`, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        await client.drm.licenses.revoke(id);
        console.log(chalk.green(`License ${id} revoked.`));
      }),
    );

  // Policies
  const policies = drm.command("policies").description("Manage DRM policies");

  policies
    .command("list")
    .description("List DRM policies")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.drm.policies.list({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  policies
    .command("create")
    .description("Create a DRM policy")
    .requiredOption("--name <name>", "Policy name")
    .option("--rules <json>", "JSON rules for the policy")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const rules = opts.rules ? JSON.parse(opts.rules as string) : undefined;
        const result = await client.drm.policies.create({
          name: opts.name,
          rules,
        });
        console.log(chalk.green(`Policy created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  policies
    .command("update <id>")
    .description("Update a DRM policy")
    .option("--name <name>", "New policy name")
    .option("--rules <json>", "Updated JSON rules")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const updates: Record<string, unknown> = {};
        if (opts.name) updates.name = opts.name;
        if (opts.rules) updates.rules = JSON.parse(opts.rules as string);
        const result = await client.drm.policies.update(id, updates);
        console.log(chalk.green(`Policy ${id} updated.`));
        formatOutput(result, program.opts());
      }),
    );

  policies
    .command("delete <id>")
    .description("Delete a DRM policy")
    .action(
      wrapCommand(async (id: string) => {
        const confirmed = await confirmDestructive("delete", `policy ${id}`, program.opts());
        if (!confirmed) return;
        const client = await getClient(program.opts());
        await client.drm.policies.delete(id);
        console.log(chalk.green(`Policy ${id} deleted.`));
      }),
    );

  // Keys
  const keys = drm.command("keys").description("Manage encryption keys");

  keys
    .command("rotate")
    .description("Rotate encryption keys")
    .option("--content-id <contentId>", "Rotate keys for specific content")
    .action(
      wrapCommand(async (opts) => {
        const confirmed = await confirmDestructive(
          "rotate encryption keys for",
          opts.contentId ?? "all content",
          program.opts(),
        );
        if (!confirmed) return;
        const client = await getClient(program.opts());
        const result = await client.drm.keys.rotate({
          contentId: opts.contentId,
        });
        console.log(chalk.green("Key rotation initiated."));
        formatOutput(result, program.opts());
      }),
    );
}
