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
        const result = await client.phone.call({
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
    .option("--name <name>", "Conference name")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.phone.conferences.create({
          name: opts.name,
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
        const result = await client.phone.conferences.list();
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
        const result = await client.phone.numbers.list();
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
        const result = await client.phone.numbers.provision({
          country: opts.country,
          areaCode: opts.areaCode,
        });
        console.log(chalk.green(`Number provisioned: ${result.number}`));
        formatOutput(result, program.opts());
      }),
    );
}
