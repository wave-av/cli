import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";

const PAGE_MAP: Record<string, string> = {
  dashboard: "https://wave.online/dashboard",
  streams: "https://wave.online/dashboard/streams",
  studio: "https://wave.online/dashboard/production",
  settings: "https://wave.online/dashboard/settings",
  billing: "https://wave.online/dashboard/settings/billing",
  api: "https://wave.online/dashboard/settings/api-keys",
  docs: "https://docs.wave.online",
  status: "https://status.wave.online",
  marketplace: "https://wave.online/marketplace",
  fleet: "https://wave.online/dashboard/fleet",
  analytics: "https://wave.online/dashboard/analytics",
  recordings: "https://wave.online/dashboard/recordings",
  integrations: "https://wave.online/dashboard/integrations",
};

export function registerOpenCommands(program: Command): void {
  program
    .command("open [page]")
    .description("Open WAVE pages in your browser")
    .action(
      wrapCommand(async (page?: string) => {
        if (!page) {
          console.log(chalk.bold("Available pages:\n"));
          for (const [name, url] of Object.entries(PAGE_MAP)) {
            console.log(`  ${chalk.cyan(name.padEnd(16))} ${chalk.gray(url)}`);
          }
          console.log(chalk.gray(`\nUsage: wave open <page>`));
          return;
        }

        const url = PAGE_MAP[page.toLowerCase()];
        if (!url) {
          console.error(
            chalk.red(
              `Unknown page "${page}". Run ${chalk.bold("wave open")} to see available pages.`,
            ),
          );
          process.exit(1);
        }

        const open = (await import("open")).default;
        await open(url);
        console.log(chalk.green(`Opened ${url}`));
      }),
    );
}
