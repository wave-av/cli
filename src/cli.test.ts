import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProgram } from "./cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Regression test for `wave --version` printing a hardcoded "1.0.0" instead of the actual
 * published package version (1.0.8+). See CHANGELOG for the incident.
 */
describe("wave --version", () => {
  it("reports the version from package.json, not a hardcoded string", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
    ) as { version: string };

    const program = createProgram();
    expect(program.version()).toBe(pkg.version);
    // The bug shipped as literally "1.0.0" regardless of the real published version.
    if (pkg.version !== "1.0.0") {
      expect(program.version()).not.toBe("1.0.0");
    }
  });
});
