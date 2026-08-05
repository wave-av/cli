import { Command } from "commander";
import chalk from "chalk";
import { writeFile, mkdir, readFile, readdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
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
  /** Directory name under packages/cli/templates/ */
  dirName: string;
}

const TEMPLATES: TemplateDefinition[] = [
  {
    name: "WebRTC Quickstart",
    description: "Browser-based live streaming with WebRTC",
    dirName: "webrtc-demo",
  },
  {
    name: "SRT Ingest",
    description: "Low-latency SRT ingest for professional streaming",
    dirName: "srt-contribution",
  },
  {
    name: "Webhook Handler",
    description: "Express server handling WAVE webhooks",
    dirName: "webhook-handler",
  },
  {
    name: "API Integration",
    description: "Node.js API integration boilerplate",
    dirName: "api-integration",
  },
  {
    name: "Studio Plugin",
    description: "Studio plugin for custom production features",
    dirName: "studio-plugin",
  },
];

/**
 * Resolves the absolute path to the templates directory.
 * Works both in development (src/) and built (dist/) environments.
 */
function getTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // Walk up from src/commands/init/ or dist/commands/init/ to package root
  const fileDir = dirname(thisFile);
  const packageRoot = fileDir.endsWith(`${sep}dist`) ? resolve(fileDir, "..") : resolve(fileDir, "..", "..", "..");
  return join(packageRoot, "templates");
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
 * Rewrites the "name" field in a template's package.json to match the project name.
 */
async function rewritePackageName(projectDir: string, projectName: string): Promise<void> {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return;

  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  pkg["name"] = projectName;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
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
          const match = TEMPLATES.find(
            (t) =>
              t.dirName === opts.template ||
              t.name.toLowerCase().replace(/\s+/g, "-") === opts.template,
          );
          if (!match) {
            const valid = TEMPLATES.map((t) => t.dirName).join(", ");
            throw new Error(
              `Unknown template "${opts.template}". Available templates: ${valid}`,
            );
          }
          selectedTemplate = match;
        } else {
          const choices = TEMPLATES.map((t) => ({
            name: `${t.name} - ${t.description}`,
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
        const templatesDir = getTemplatesDir();
        const templateDir = join(templatesDir, selectedTemplate.dirName);

        // Validate template directory exists and is within templates root
        const resolvedTemplateDir = resolve(templateDir);
        const resolvedTemplatesRoot = resolve(templatesDir);
        if (!resolvedTemplateDir.startsWith(resolvedTemplatesRoot)) {
          throw new Error("Invalid template path");
        }

        const templateExists = existsSync(resolvedTemplateDir);

        await withSpinner(`Creating ${projectName}/`, async () => {
          if (templateExists) {
            // Copy template files into the new project directory
            await copyDir(resolvedTemplateDir, dir);
          } else {
            // Fallback: create minimal scaffold if template dir missing
            await mkdir(join(dir, "src"), { recursive: true });
          }

          // Rewrite package.json name to match project name
          await rewritePackageName(dir, projectName);

          // Generate wave.config.ts
          const configContent = `import { defineConfig } from "@wave-av/sdk";

export default defineConfig({
  project: "${projectName}",
  template: "${selectedTemplate.dirName}",
  streaming: {
    protocol: "webrtc",
    fallback: ["srt", "rtmp"],
  },
});
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

Created with [WAVE CLI](https://docs.wave.online/cli) using the **${selectedTemplate.name}** template.

## Getting Started

\`\`\`bash
# Set your API key
cp .env.example .env.local
# Edit .env.local with your WAVE API key from https://wave.online/dashboard/settings/api-keys

# Install dependencies
npm install

# Run the project
npm run dev
\`\`\`

## Learn More

- [WAVE Documentation](https://docs.wave.online)
- [API Reference](https://docs.wave.online/api)
- [SDK Reference](https://docs.wave.online/sdk)
`;
          await writeFile(join(dir, "README.md"), readmeContent, "utf-8");
        });

        console.log(chalk.green(`  Created ${projectName}/`));

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
        console.log(`  wave login`);
        console.log(`  npm run dev\n`);
      }),
    );
}
