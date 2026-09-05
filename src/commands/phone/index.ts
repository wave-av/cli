import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerPhoneCommands(program: Command): void {
  const phone = program.command("phone").description("Telephony and phone services");

  phone
    .command("call")
    .description("Initiate a phone call")
    .requiredOption("--to <number>", "Destination phone number")
    .requiredOption("--from <number>", "Source phone number")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.phone.makeCall({
          to: opts.to,
          from: opts.from,
        });
        console.log(chalk.green(`Call initiated: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  // Conference subcommands
  const conference = phone.command("conference").description("Manage conference calls");

  conference
    .command("create")
    .description("Create a conference call")
    .requiredOption("--name <name>", "Conference name")
    .option("--max-participants <n>", "Maximum participants")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.phone.createConference({
          friendly_name: opts.name,
          max_participants: opts.maxParticipants
            ? parseInt(opts.maxParticipants)
            : undefined,
        });
        console.log(chalk.green(`Conference created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  conference
    .command("list")
    .description("List conference calls")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        // listConferences, not getConference: this lists many, and the compiler's
        // "did you mean getConference?" hint points at a single-fetch route.
        const result = await client.phone.listConferences();
        formatOutput(result.data, program.opts());
      }),
    );

  // Numbers subcommands
  const numbers = phone.command("numbers").description("Manage phone numbers");

  numbers
    .command("list")
    .description("List provisioned phone numbers")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.phone.listNumbers();
        formatOutput(result.data, program.opts());
      }),
    );

  numbers
    .command("provision")
    .description("Provision a new phone number")
    .option("--country <code>", "Country code", "US")
    .option("--area-code <code>", "Area code")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Provisioning is two API steps: search availability, then purchase a
        // specific number. There is no single "provision" route.
        const available = await client.phone.searchAvailableNumbers({
          country_code: opts.country,
          area_code: opts.areaCode,
          limit: 1,
        });
        const candidate = available[0];
        if (!candidate) {
          throw new Error(
            `No numbers available for country ${opts.country}` +
              (opts.areaCode ? ` area code ${opts.areaCode}` : "") +
              ".",
          );
        }
        const result = await client.phone.purchaseNumber(candidate.number);
        console.log(chalk.green(`Number provisioned: ${result.number}`));
        formatOutput(result, program.opts());
      }),
    );
}
