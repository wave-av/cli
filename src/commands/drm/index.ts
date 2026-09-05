import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";
import { confirmDestructive } from "../../lib/output/index.js";

const DRM_PROVIDERS = ["widevine", "fairplay", "playready"] as const;

function parseProviders(value: string): ("widevine" | "fairplay" | "playready")[] {
  const parsed = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parsed.length === 0) {
    throw new Error(`--providers must name at least one of: ${DRM_PROVIDERS.join(", ")}.`);
  }
  return parsed.map((p) => oneOf("--providers", p, DRM_PROVIDERS));
}

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
        const result = await client.drm.listLicenses({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  licenses
    .command("create")
    .description("Issue a DRM license")
    .requiredOption("--asset-id <assetId>", "Asset ID")
    .requiredOption("--policy-id <policyId>", "Policy ID")
    .option("--device-id <deviceId>", "Bind the license to a device")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.drm.issueLicense(
          opts.assetId,
          opts.policyId,
          opts.deviceId,
        );
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
        await client.drm.revokeLicense(id);
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
        const result = await client.drm.listPolicies({
          limit: parseInt(opts.limit),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  policies
    .command("create")
    .description("Create a DRM policy")
    .requiredOption("--name <name>", "Policy name")
    .requiredOption(
      "--providers <providers>",
      "Comma-separated DRM providers (widevine, fairplay, playready)",
    )
    .option("--allow-offline", "Permit offline playback")
    .option("--max-devices <n>", "Maximum devices per license")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.drm.createPolicy({
          name: opts.name,
          providers: parseProviders(opts.providers),
          allow_offline: opts.allowOffline,
          max_devices: opts.maxDevices ? parseInt(opts.maxDevices) : undefined,
        });
        console.log(chalk.green(`Policy created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  policies
    .command("update <id>")
    .description("Update a DRM policy")
    .option("--name <name>", "New policy name")
    .option("--providers <providers>", "Replacement comma-separated DRM providers")
    .option("--max-devices <n>", "Maximum devices per license")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.drm.updatePolicy(id, {
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.providers ? { providers: parseProviders(opts.providers) } : {}),
          ...(opts.maxDevices ? { max_devices: parseInt(opts.maxDevices) } : {}),
        });
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
        await client.drm.removePolicy(id);
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
      wrapCommand(async () => {
        // DrmAPI has no content-encryption-key rotation route. The closest
        // real primitive is per-license issue/revoke, which is a different
        // operation (per playback license, not per-content key). Fail
        // loudly rather than fake a rotation.
        throw new Error(
          "Rotating encryption keys is not supported by the current SDK. Use `wave drm licenses revoke <id>` to revoke a specific license.",
        );
      }),
    );
}
