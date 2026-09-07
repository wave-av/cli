import { createProgram } from "./cli.js";

async function main(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "An unexpected error occurred");
  process.exit(1);
});
