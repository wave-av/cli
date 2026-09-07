import chalk from "chalk";

export function formatJson(data: unknown, colorize = true): string {
  const json = JSON.stringify(data, null, 2);
  if (!colorize) return json;

  return json.replace(/("(?:\\.|[^"\\])*")\s*:/g, (_match, key: string) => `${chalk.cyan(key)}:`);
}
