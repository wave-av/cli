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

/**
 * Path segments that must never be traversed or written.
 *
 * `wave config set <key> <value>` takes `key` straight from argv, so without this guard
 * `wave config set __proto__.polluted x` walks INTO `Object.prototype` (it is an object,
 * so the "create missing container" branch below accepts it) and assigns onto it —
 * poisoning every object in the process for the rest of the run.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Split a dotted config path into segments, rejecting anything unsafe.
 *
 * @throws if the path is empty, has an empty segment, or names a prototype-chain key.
 */
export function parseConfigPath(path: string): string[] {
  const keys = path.split(".");
  if (keys.length === 0 || path === "") {
    throw new Error("Configuration key must not be empty.");
  }
  for (const key of keys) {
    if (key === "") {
      throw new Error(`Invalid configuration key "${path}": empty path segment.`);
    }
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(
        `Invalid configuration key "${path}": "${key}" is a reserved property name.`,
      );
    }
  }
  return keys;
}

export function getNestedValue(obj: object, path: string): unknown {
  const keys = parseConfigPath(path);
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    // Own properties only: an inherited member is not config the user set.
    if (!Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function setNestedValue(obj: object, path: string, value: string): void {
  const keys = parseConfigPath(path);
  let current: Record<string, unknown> = obj as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    // `Object.hasOwn` matters as much as the key guard: without it an INHERITED object-valued
    // member would satisfy the typeof check and be descended into rather than shadowed.
    if (!Object.hasOwn(current, key) || typeof current[key] !== "object" || current[key] === null) {
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
