import inquirer from "inquirer";

export async function confirmDestructive(
  action: string,
  resource: string,
  opts: { confirm?: boolean },
): Promise<boolean> {
  if (opts.confirm) return true;

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: "confirm",
      name: "confirmed",
      message: `Are you sure you want to ${action} ${resource}?`,
      default: false,
    },
  ]);

  return confirmed;
}
