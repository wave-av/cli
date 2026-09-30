import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("offers every shipped template (blank/multi-camera/podcast were unreachable) and ships no withheld one", () => {
    const shipped = readdirSync(SHIPPED_TEMPLATES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const offered = TEMPLATES.map((t) => t.dirName);
    const withheld = Object.keys(WITHHELD_TEMPLATES);
    expect(offered.filter((d) => withheld.includes(d))).toEqual([]);
    expect([...offered].sort()).toEqual(shipped);
    // A withheld template called SDK methods that do not exist; its code must not ship at all.
    for (const name of withheld) expect(existsSync(join(SHIPPED_TEMPLATES, name)), name).toBe(false);
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
    for (const t of TEMPLATES) {
      const file = join(SHIPPED_TEMPLATES, t.dirName, "package.json");
      expect(existsSync(file), `${t.dirName}/package.json`).toBe(true);
      const pkg = JSON.parse(readFileSync(file, "utf-8")) as { dependencies?: Record<string, string> };
      const deps = Object.keys(pkg.dependencies ?? {});
      expect(deps, t.dirName).not.toContain("@wave/sdk");
      if (deps.some((d) => d.includes("sdk"))) expect(deps, t.dirName).toContain("@wave-av/sdk");
    }
  });
});

/** The whole command, through the real command tree, into a throwaway working directory. */
describe("wave init: scaffolding (command level)", () => {
  let work: string;
  let out: string[];

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "wave-cli-init-run-"));
    out = [];
    vi.spyOn(process, "cwd").mockReturnValue(work);
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(work, { recursive: true, force: true });
  });

  async function wave(...args: string[]): Promise<void> {
    const { createProgram } = await import("../../cli.js");
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(["node", "wave", ...args]);
  }

  it("writes a buildable project: template files, package.json renamed, tsconfig, config, README", async () => {
    await wave("init", "my-app", "--template", "blank", "--no-install");
    const dir = join(work, "my-app");

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      name: string;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe("my-app");
    expect(pkg.dependencies["@wave-av/sdk"]).toBeDefined();
    expect(pkg.devDependencies["@types/node"]).toBeDefined();

    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
    // The template's own example env file is copied (the template's error message points at it).
    expect(existsSync(join(dir, ".env.example"))).toBe(true);
    const tsconfig = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf-8")) as { compilerOptions: { rootDir: string } };
    expect(tsconfig.compilerOptions.rootDir).toBe("src");
    const config = readFileSync(join(dir, "wave.config.ts"), "utf-8");
    expect(config).toContain('project: "my-app"');
    expect(config).not.toContain("defineConfig");
    expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toContain(".wave/");
    expect(readFileSync(join(dir, "README.md"), "utf-8")).toContain("https://docs.wave.online/docs/cli");
    expect(out.join("\n")).toMatch(/Ready!/);
  });

  it("prints the preview note for a template whose routes are not served yet", async () => {
    await wave("init", "live-app", "--template", "webrtc-demo", "--no-install");
    expect(existsSync(join(work, "live-app", "package.json"))).toBe(true);
    expect(out.join("\n")).toMatch(/Preview: .*\/v1\/streams/);
  });

  it("refuses a withheld template and an existing directory without writing anything", async () => {
    await expect(wave("init", "x", "--template", "studio-plugin", "--no-install")).rejects.toThrow(/process\.exit\(1\)/);
    expect(existsSync(join(work, "x"))).toBe(false);
    expect(out.join("\n")).toMatch(/not available yet/);

    mkdirSync(join(work, "taken"));
    await expect(wave("init", "taken", "--template", "blank", "--no-install")).rejects.toThrow(/process\.exit\(1\)/);
    expect(readdirSync(join(work, "taken"))).toEqual([]);
  });
});
