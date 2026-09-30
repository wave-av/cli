import { Command } from "commander";
import chalk from "chalk";
import { writeFile, mkdir, readFile, readdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { wrapCommand } from "../../lib/errors.js";
import { promptSelect, promptInput, promptConfirm } from "../../lib/prompts.js";
import { withSpinner } from "../../lib/output/spinner.js";

/**
 * Template definition mapping user-facing names to filesystem template directories.
 */
interface TemplateDefinition {
  /** Display name shown in the interactive picker */
  name: string;
  /** Short description shown alongside the name */
  description: string;
  /** Directory name under templates/ */
  dirName: string;
  /**
   * Set when the template's API calls target routes not confirmed served today: it scaffolds and
   * type-checks, but its calls can fail (ROUTE_NOT_FOUND) until the routes are served. Shown in
   * the picker and printed after scaffolding, so nobody finds out from a runtime 404.
   */
  preview?: string;
}

const STREAMS_PREVIEW =
  "Preview: it creates a live stream (/v1/streams), which the WAVE API does not serve yet, so its " +
  "first call fails with ROUTE_NOT_FOUND until that route is live.";

/**
 * The templates `wave init` offers. `blank` and `api-integration` call served routes (GET
 * /v1/billing, /v1/billing/usage) and run end to end today; the rest are marked preview.
 */
export const TEMPLATES: TemplateDefinition[] = [
  {
    name: "Blank",
    description: "Minimal project: authenticate and make one API call",
    dirName: "blank",
  },
  {
    name: "API Integration",
    description: "Node.js API integration boilerplate",
    dirName: "api-integration",
  },
  {
    name: "WebRTC Quickstart",
    description: "Browser-based live streaming with WebRTC",
    dirName: "webrtc-demo",
    preview: STREAMS_PREVIEW,
  },
  {
    name: "SRT Ingest",
    description: "Low-latency SRT ingest for professional streaming",
    dirName: "srt-contribution",
    preview: STREAMS_PREVIEW,
  },
  {
    name: "Multi-Camera",
    description: "Multi-camera production with scenes",
    dirName: "multi-camera",
    preview:
      "Preview: it drives a Studio production (/v1/productions). That route is gated " +
      "(productions:write) and not yet confirmed served, so its calls may fail until it is.",
  },
  {
    name: "Podcast",
    description: "Audio-first recording with transcription",
    dirName: "podcast",
    preview: STREAMS_PREVIEW,
  },
];

/**
 * Template directories that ship but are not offered, with the reason. Each calls an SDK method
 * that does not exist in @wave-av/sdk, so the generated project could neither compile nor run.
 * `--template <name>` explains instead of reporting an unknown template.
 */
export const WITHHELD_TEMPLATES: Record<string, string> = {
  "webhook-handler":
    "it verifies signatures with `wave.webhooks.verify`, which @wave-av/sdk does not provide. " +
    "List your org's subscriptions with `wave webhook-subscriptions list` meanwhile.",
  "studio-plugin":
    "it calls `wave.studio.registerPlugin` / `wave.studio.connect`, which neither @wave-av/sdk " +
    "nor the WAVE API provides.",
};

/** tsconfig.json for a generated project (no template ships one, so `npm run build` had no config). */
const PROJECT_TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    types: ["node"],
    outDir: "dist",
    rootDir: "src",
  },
  include: ["src"],
};

/**
 * Finds the package's templates/ directory by walking up from this module to the first ancestor
 * that holds both package.json and templates/. The layout differs by build: tsup bundles every
 * command into dist/index.js (package root = one level up), while tests and `tsx` run this file
 * from src/commands/init/ (three levels up). 1.0.10 hard-coded three levels, so the published
 * CLI looked in <prefix>/lib/node_modules/templates, found nothing, and silently scaffolded an
 * empty project with no package.json.
 *
 * Throws instead of returning a guess: a missing templates/ is a packaging bug to surface.
 */
export function findTemplatesDir(startDir = dirname(fileURLToPath(import.meta.url))): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "templates");
    if (existsSync(join(dir, "package.json")) && existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `WAVE CLI templates directory not found above ${startDir}. The installation is incomplete; ` +
      "reinstall with `npm install -g @wave-av/cli`.",
  );
}

/**
 * Recursively copies a directory tree from src to dest.
 * Creates destination directories as needed.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Rewrites the "name" field in a template's package.json to match the project name, and adds the
 * Node type definitions the generated tsconfig.json asks for (the templates read process.env).
 */
async function finalizePackageJson(projectDir: string, projectName: string): Promise<void> {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return;

  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  pkg["name"] = projectName;
  const devDependencies = { ...((pkg["devDependencies"] as Record<string, string> | undefined) ?? {}) };
  devDependencies["@types/node"] ??= "^22";
  pkg["devDependencies"] = devDependencies;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
}

/** Resolve `--template <value>` (directory name or kebab-cased display name). */
export function resolveTemplate(value: string): TemplateDefinition {
  const match = TEMPLATES.find(
    (t) => t.dirName === value || t.name.toLowerCase().replace(/\s+/g, "-") === value,
  );
  if (match) return match;
  const withheld = WITHHELD_TEMPLATES[value];
  if (withheld) {
    throw new Error(`Template "${value}" is not available yet: ${withheld}`);
  }
  const valid = TEMPLATES.map((t) => t.dirName).join(", ");
  throw new Error(`Unknown template "${value}". Available templates: ${valid}`);
}

export function registerInitCommands(program: Command): void {
  program
    .command("init [name]")
    .description("Initialize a new WAVE project")
    .option("--template <template>", "Project template to use (skips interactive picker)")
    .option("--no-install", "Skip dependency installation")
    .action(
      wrapCommand(async (name: string | undefined, opts: { template?: string; install: boolean }) => {
        // 1. Template selection: use --template flag or interactive picker
        let selectedTemplate: TemplateDefinition;

        if (opts.template) {
          selectedTemplate = resolveTemplate(opts.template);
        } else {
          const choices = TEMPLATES.map((t) => ({
            name: `${t.name} - ${t.description}${t.preview ? " (preview)" : ""}`,
            value: t,
          }));
          selectedTemplate = await promptSelect<TemplateDefinition>(
            "Choose a template:",
            choices,
          );
        }

        // 2. Project name: use argument or interactive prompt
        const projectName = name ?? (await promptInput("Project name:", "my-wave-project"));
        const dir = join(process.cwd(), projectName);

        if (existsSync(dir)) {
          throw new Error(
            `Directory "${projectName}" already exists. Choose a different name or remove the directory.`,
          );
        }

        console.log(
          chalk.bold(
            `\nCreating "${projectName}" with ${selectedTemplate.name} template...\n`,
          ),
        );

        // 3. Scaffold the project from template files
        const templatesDir = findTemplatesDir();
        const templateDir = resolve(templatesDir, selectedTemplate.dirName);

        // Validate template directory exists and is within templates root
        if (!templateDir.startsWith(resolve(templatesDir))) {
          throw new Error("Invalid template path");
        }
        if (!existsSync(join(templateDir, "package.json"))) {
          throw new Error(
            `Template "${selectedTemplate.dirName}" is missing from this installation (${templateDir}). ` +
              "Reinstall with `npm install -g @wave-av/cli`.",
          );
        }

        await withSpinner(`Creating ${projectName}/`, async () => {
          await copyDir(templateDir, dir);

          // Rewrite package.json name to match project name
          await finalizePackageJson(dir, projectName);

          // tsconfig.json: `npm run build` runs tsc, and no template ships a config for it.
          if (!existsSync(join(dir, "tsconfig.json"))) {
            await writeFile(
              join(dir, "tsconfig.json"),
              JSON.stringify(PROJECT_TSCONFIG, null, 2) + "\n",
              "utf-8",
            );
          }

          // Generate wave.config.ts. Plain data: @wave-av/sdk exports no defineConfig (1.0.10 imported
          // one, so the generated project failed to type-check).
          const configContent = `export default {
  project: ${JSON.stringify(projectName)},
  template: ${JSON.stringify(selectedTemplate.dirName)},
} as const;
`;
          await writeFile(join(dir, "wave.config.ts"), configContent, "utf-8");

          // Generate .gitignore (append if template already has one)
          const gitignorePath = join(dir, ".gitignore");
          const gitignoreContent = `.env.local
.wave/
node_modules/
dist/
`;
          await writeFile(gitignorePath, gitignoreContent, "utf-8");

          // Generate README.md
          const readmeContent = `# ${projectName}

Created with [WAVE CLI](https://docs.wave.online/docs/cli) using the **${selectedTemplate.name}** template.

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Your WAVE API key (create one in the console: https://console.wave.online).
# The project reads WAVE_API_KEY from the environment; .env.example lists the variables it uses.
export WAVE_API_KEY=wave_live_...

# Run the project
npm run dev
\`\`\`

## Learn More

- [WAVE Documentation](https://docs.wave.online)
- [API Reference](https://docs.wave.online/api)
- [CLI Reference](https://docs.wave.online/docs/cli)
`;
          await writeFile(join(dir, "README.md"), readmeContent, "utf-8");
        });

        console.log(chalk.green(`  Created ${projectName}/`));
        if (selectedTemplate.preview) {
          console.log(chalk.yellow(`\n  ${selectedTemplate.preview}`));
        }

        // 4. Optionally install dependencies
        if (opts.install) {
          const shouldInstall = await promptConfirm("Install dependencies?", true);
          if (shouldInstall) {
            await withSpinner("Installing dependencies", async () => {
              const result = spawnSync("npm", ["install"], {
                cwd: dir,
                stdio: "pipe",
                shell: false,
              });
              if (result.status !== 0) {
                const stderr = result.stderr?.toString() ?? "";
                throw new Error(`npm install failed: ${stderr}`);
              }
            });
            console.log(chalk.green("  Installed dependencies"));
          }
        }

        // 5. Success output
        console.log(chalk.green("\n  Ready!"));
        console.log(`\nNext steps:`);
        console.log(`  cd ${projectName}`);
        if (!opts.install) {
          console.log(`  npm install`);
        }
        console.log(`  export WAVE_API_KEY=wave_live_...   (the project reads the key from the environment)`);
        console.log(`  npm run dev\n`);
      }),
    );
}
