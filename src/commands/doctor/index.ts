import { Command } from "commander";
import chalk from "chalk";
import { getConfigPath, loadConfig } from "../../lib/config/manager.js";
import { getDefaultConfig } from "../../lib/config/schema.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { resolveProjectName } from "../../lib/auth/credentials.js";
import type { WaveConfig } from "../../types/index.js";
import { formatOutput } from "../../lib/output/index.js";
import { KeychainTimeoutError, wrapCommand } from "../../lib/errors.js";
import { detectEnvironment } from "../../lib/environment.js";
import { maskSecret } from "../../lib/mask.js";

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
}

export function registerDoctorCommands(program: Command): void {
  program
    .command("doctor")
    .description("Check your WAVE CLI setup and diagnose issues")
    .action(
      wrapCommand(async () => {
        const checks: CheckResult[] = [];

        // 1. Node.js version
        const nodeVersion = process.version;
        const major = parseInt(nodeVersion.slice(1).split(".")[0] ?? "0");
        checks.push({
          name: "Node.js",
          status: major >= 18 ? "pass" : "fail",
          message: `${nodeVersion} ${major >= 18 ? "(supported)" : "(requires >=18)"}`,
          fix: major < 18 ? "Install Node.js 18+: https://nodejs.org" : undefined,
        });

        // 2. Config file. Loaded once; a file the CLI refuses to use is a failed check, reported
        // with the reason, and the remaining checks run against defaults.
        let config: WaveConfig;
        try {
          config = await loadConfig();
          checks.push({
            name: "Config",
            status: "pass",
            message: `Loaded (project: ${config.currentProject})`,
          });
        } catch (err) {
          config = getDefaultConfig();
          checks.push({
            name: "Config",
            status: "fail",
            message: err instanceof Error ? err.message : String(err),
            fix: `Fix or move aside ${getConfigPath()}`,
          });
        }

        // 3. Authentication, for the project every other command would use (--project,
        // WAVE_PROJECT, then the current project).
        const project = resolveProjectName(config, program.opts().project);
        const envKey = process.env["WAVE_API_KEY"];
        // WAVE_API_KEY wins (same order as every command), so the keychain is only consulted
        // without it: a locked keychain must not stall a diagnostic that does not need it.
        let apiKey: string | null = null;
        let credentialStoreError: string | null = null;
        if (!envKey) {
          try {
            apiKey = await getApiKey(project);
          } catch (err) {
            // A broken credential store (keytar installed without its full API, an unreadable
            // credentials file) is exactly what doctor exists to diagnose: report it as the Auth
            // check and run the rest. A keychain timeout is the exception: the native call is
            // still blocked, so the process cannot exit normally, and wrapCommand has to end it.
            if (err instanceof KeychainTimeoutError) throw err;
            credentialStoreError = err instanceof Error ? err.message : String(err);
          }
        }
        if (credentialStoreError) {
          checks.push({
            name: "Auth",
            status: "fail",
            message: `Credential store unusable: ${credentialStoreError}`,
            fix: "export WAVE_API_KEY=...  (or WAVE_CREDENTIAL_STORE=file, then wave auth login)",
          });
        } else if (envKey) {
          checks.push({
            name: "Auth",
            status: "pass",
            // Masked, never a prefix: doctor output gets pasted into bug reports, and the
            // leading characters of a key carry its type/environment. See lib/mask.ts.
            message: `WAVE_API_KEY env var set (${maskSecret(envKey)})`,
          });
        } else if (apiKey) {
          checks.push({
            name: "Auth",
            status: "pass",
            message: `API key stored for "${project}" (${maskSecret(apiKey)})`,
          });
        } else {
          checks.push({
            name: "Auth",
            status: "fail",
            message: `No API key found for project "${project}"`,
            fix: "wave auth login  (or export WAVE_API_KEY=...)",
          });
        }

        // 4. Project configuration. `wave auth login` writes the entry; `--project <name>` picks
        // which one (1.0.10 suggested a `--project-name` flag that never existed). With
        // WAVE_API_KEY set no saved project is needed at all.
        const projectCount = Object.keys(config.projects).length;
        checks.push({
          name: "Projects",
          status: projectCount > 0 || envKey ? "pass" : "warn",
          message:
            projectCount > 0
              ? `${projectCount} project(s) configured`
              : envKey
                ? "None saved (not needed: WAVE_API_KEY is set)"
                : "No projects configured",
          fix:
            projectCount === 0 && !envKey
              ? "wave auth login  (or: wave auth login --project production)"
              : undefined,
        });

        // 5. Environment detection
        const env = detectEnvironment();
        checks.push({
          name: "Environment",
          status: "pass",
          message: [
            env.isCI ? "CI" : env.isAgent ? `Agent (${env.agentName ?? "unknown"})` : "Interactive",
            env.supportsColor ? "color" : "no-color",
            env.preferJson ? "json-mode" : "table-mode",
          ].join(", "),
        });

        // 6. Telemetry
        checks.push({
          name: "Telemetry",
          status: "pass",
          message: config.telemetry.enabled ? "Enabled (anonymous)" : "Disabled",
        });

        // Output
        const opts = program.opts();
        if (opts.output === "json") {
          formatOutput(
            checks.map((c) => ({ ...c })),
            opts,
          );
        } else {
          console.log(chalk.bold("\n  WAVE CLI Doctor\n"));
          for (const check of checks) {
            const icon =
              check.status === "pass"
                ? chalk.green("✓")
                : check.status === "warn"
                  ? chalk.yellow("!")
                  : chalk.red("✗");
            console.log(`  ${icon} ${chalk.bold(check.name)}: ${check.message}`);
            if (check.fix) {
              console.log(`    ${chalk.dim("Fix:")} ${chalk.cyan(check.fix)}`);
            }
          }

          const failures = checks.filter((c) => c.status === "fail");
          const warnings = checks.filter((c) => c.status === "warn");
          console.log("");
          if (failures.length === 0 && warnings.length === 0) {
            console.log(chalk.green("  All checks passed! You're ready to go."));
          } else if (failures.length > 0) {
            console.log(
              chalk.red(`  ${failures.length} issue(s) need attention.`),
            );
          }
          console.log("");
        }

        // Non-interactive/CI/agent callers need a real exit code, not just colored text: a
        // failing check must fail the process. `process.exitCode` (not `process.exit()`) lets
        // any pending stdout writes flush before Node exits.
        if (checks.some((c) => c.status === "fail")) {
          process.exitCode = 1;
        }
      }),
    );
}
