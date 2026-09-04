import Table from "cli-table3";

export function formatTable(data: Record<string, unknown>[], columns?: string[]): string {
  if (data.length === 0) {
    return "No results found.";
  }

  const cols = columns ?? Object.keys(data[0] ?? {});
  const table = new Table({
    head: cols,
    style: { head: ["cyan"] },
  });

  for (const row of data) {
    table.push(
      cols.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return "";
        if (typeof val === "object") return JSON.stringify(val);
        const str = String(val);
        return str.length > 60 ? str.slice(0, 57) + "..." : str;
      }),
    );
  }

  return table.toString();
}

export function formatDetail(data: Record<string, unknown>): string {
  const table = new Table({
    style: { head: ["cyan"] },
  });

  for (const [key, value] of Object.entries(data)) {
    const val =
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value, null, 2)
          : String(value);
    table.push({ [key]: val });
  }

  return table.toString();
}
