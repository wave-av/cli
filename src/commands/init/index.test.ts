import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { TEMPLATES, WITHHELD_TEMPLATES, findTemplatesDir, resolveTemplate } from "./index.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SHIPPED_TEMPLATES = join(PACKAGE_ROOT, "templates");

/**
 * 1.0.10 looked for templates three directories above the BUNDLED dist/index.js, i.e.
 * <prefix>/lib/node_modules/templates, found nothing and silently scaffolded an empty src/ with
 * no package.json, then printed "Next steps: npm install".
 */
describe("wave init: templates", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("finds templates from the source layout (src/commands/init/)", () => {
    expect(findTemplatesDir()).toBe(SHIPPED_TEMPLATES);
  });

  it("finds templates from the published layout (dist/index.js next to templates/)", () => {
    // Mirror an npm install: <prefix>/lib/node_modules/@wave-av/cli/{package.json,dist/,templates/}
    const prefix = mkdtempSync(join(tmpdir(), "wave-cli-init-"));
    dirs.push(prefix);
    const pkg = join(prefix, "lib", "node_modules", "@wave-av", "cli");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    mkdirSync(join(pkg, "templates", "blank"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), "{}");
    expect(findTemplatesDir(join(pkg, "dist"))).toBe(join(pkg, "templates"));
  });

  it("throws instead of silently scaffolding an empty project when templates are missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "wave-cli-init-empty-"));
    dirs.push(empty);
    expect(() => findTemplatesDir(empty)).toThrow(/templates directory not found/);
  });

  it("accounts for every shipped template: offered, or withheld with a reason (blank/multi-camera/podcast were unreachable)", () => {
    const shipped = readdirSync(SHIPPED_TEMPLATES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const offered = TEMPLATES.map((t) => t.dirName);
    const withheld = Object.keys(WITHHELD_TEMPLATES);
    expect(offered.filter((d) => withheld.includes(d))).toEqual([]);
    expect([...offered, ...withheld].sort()).toEqual(shipped);
  });

  it("the templates that run end to end today are offered without a preview note", () => {
    for (const dirName of ["blank", "api-integration"]) {
      const t = resolveTemplate(dirName);
      expect(t.preview, dirName).toBeUndefined();
    }
    expect(resolveTemplate("multi-camera").preview).toMatch(/not yet confirmed served/);
    expect(resolveTemplate("webrtc-demo").preview).toMatch(/does not serve yet/);
  });

  it("--template for a withheld template explains why instead of 'Unknown template'", () => {
    expect(() => resolveTemplate("webhook-handler")).toThrow(/not available yet: .*wave\.webhooks\.verify/);
    expect(() => resolveTemplate("nope")).toThrow(/Unknown template "nope"/);
  });

  it("every shipped template has a package.json that depends on the real SDK package (@wave-av/sdk)", () => {
    for (const t of [...TEMPLATES.map((x) => x.dirName), ...Object.keys(WITHHELD_TEMPLATES)].map((dirName) => ({ dirName }))) {
      const file = join(SHIPPED_TEMPLATES, t.dirName, "package.json");
      expect(existsSync(file), `${t.dirName}/package.json`).toBe(true);
      const pkg = JSON.parse(readFileSync(file, "utf-8")) as { dependencies?: Record<string, string> };
      const deps = Object.keys(pkg.dependencies ?? {});
      expect(deps, t.dirName).not.toContain("@wave/sdk");
      if (deps.some((d) => d.includes("sdk"))) expect(deps, t.dirName).toContain("@wave-av/sdk");
    }
  });
});
