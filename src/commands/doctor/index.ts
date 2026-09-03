import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../../lib/config/manager.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { detectEnvironment } from "../../lib/environment.js";

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

        // 2. Config file
        try {
          const config = await loadConfig();
          checks.push({
            name: "Config",
            status: "pass",
            message: `Loaded (project: ${config.currentProject})`,
          });
        } catch {
          checks.push({
            name: "Config",
            status: "warn",
            message: "Could not load config (using defaults)",
            fix: "wave config list",
          });
        }

        // 3. Authentication
        const config = await loadConfig();
        const apiKey = await getApiKey(config.currentProject);
        const envKey = process.env["WAVE_API_KEY"];
        if (envKey) {
          checks.push({
            name: "Auth",
            status: "pass",
            message: `WAVE_API_KEY env var set (${envKey.slice(0, 12)}...)`,
          });
        } else if (apiKey) {
          checks.push({
            name: "Auth",
            status: "pass",
            message: `API key stored for "${config.currentProject}" (${apiKey.slice(0, 12)}...)`,
          });
        } else {
          checks.push({
            name: "Auth",
            status: "fail",
            message: "No API key found",
            fix: "wave login",
          });
        }

        // 4. Project configuration
        const projectCount = Object.keys(config.projects).length;
        checks.push({
          name: "Projects",
          status: projectCount > 0 ? "pass" : "warn",
          message:
            projectCount > 0
              ? `${projectCount} project(s) configured`
              : "No projects configured",
          fix: projectCount === 0 ? "wave login --project-name production" : undefined,
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
