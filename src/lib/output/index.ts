import type { OutputFormat } from "../../types/index.js";
import { formatTable, formatDetail } from "./table.js";
import { formatJson } from "./json.js";
import { formatYaml } from "./yaml.js";

export { formatTable, formatDetail } from "./table.js";
export { formatJson } from "./json.js";
export { formatYaml } from "./yaml.js";
export { withSpinner, startSpinner } from "./spinner.js";
export { confirmDestructive } from "./confirm.js";

export function formatOutput(data: unknown, opts: { output?: OutputFormat } = {}): void {
  const format = opts.output ?? "table";

  switch (format) {
    case "json":
      console.log(formatJson(data));
      break;
    case "yaml":
      console.log(formatYaml(data));
      break;
    case "table":
    default:
      if (Array.isArray(data)) {
        console.log(formatTable(data as Record<string, unknown>[]));
      } else if (data && typeof data === "object") {
        console.log(formatDetail(data as Record<string, unknown>));
      } else {
        console.log(String(data));
      }
      break;
  }
}
