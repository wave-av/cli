import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";
import { formatOutput } from "../../lib/output/index.js";
import { loadConfig, updateConfig, getConfigPath } from "../../lib/config/manager.js";
import { getDefaultConfig } from "../../lib/config/schema.js";

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Manage CLI configuration");

  config
    .command("list")
    .description("List all configuration values")
    .action(
      wrapCommand(async () => {
        const cfg = await loadConfig();
        console.log(chalk.gray(`Config file: ${getConfigPath()}\n`));
        formatOutput(cfg, program.opts());
      }),
    );

  config
    .command("get <key>")
    .description("Get a configuration value")
    .action(
      wrapCommand(async (key: string) => {
        const cfg = await loadConfig();
        const value = getNestedValue(cfg, key);
        if (value === undefined) {
          throw new Error(`Configuration key "${key}" not found.`);
        }
        if (typeof value === "object" && value !== null) {
          formatOutput(value, program.opts());
        } else {
          console.log(String(value));
        }
      }),
    );

  config
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action(
      wrapCommand(async (key: string, value: string) => {
        await updateConfig((cfg) => {
          const updated = { ...cfg };
          setNestedValue(updated, key, value);
          return updated;
        });
        console.log(chalk.green(`Set ${chalk.bold(key)} = ${value}`));
      }),
    );

  config
    .command("reset")
    .description("Reset configuration to defaults")
    .action(
      wrapCommand(async () => {
        const defaults = getDefaultConfig();
        await updateConfig(() => defaults);
        console.log(chalk.green("Configuration reset to defaults."));
      }),
    );
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: string): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  // Auto-parse booleans and numbers
  if (value === "true") current[lastKey] = true;
  else if (value === "false") current[lastKey] = false;
  else if (!isNaN(Number(value)) && value !== "") current[lastKey] = Number(value);
  else current[lastKey] = value;
}
