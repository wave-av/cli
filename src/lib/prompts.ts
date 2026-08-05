/**
 * Interactive Prompts
 *
 * Wrapper around inquirer for common prompt patterns.
 * Handles non-interactive (CI) environments by falling back
 * to default values or throwing descriptive errors.
 */

import inquirer from "inquirer";

/**
 * Detects whether the current environment is non-interactive (e.g. CI, piped stdin).
 */
function isNonInteractive(): boolean {
  return (
    Boolean(process.env["CI"]) ||
    Boolean(process.env["WAVE_NON_INTERACTIVE"]) ||
    !process.stdin.isTTY
  );
}

/**
 * Prompt the user to select from a list of choices.
 *
 * In non-interactive environments, returns the first choice's value.
 */
export async function promptSelect<T>(
  message: string,
  choices: Array<{ name: string; value: T }>,
): Promise<T> {
  if (isNonInteractive()) {
    const first = choices[0];
    if (!first) {
      throw new Error(
        `Cannot prompt in non-interactive mode and no choices provided for: ${message}`,
      );
    }
    return first.value;
  }

  const { selection } = await inquirer.prompt<{ selection: T }>([
    {
      type: "list",
      name: "selection",
      message,
      choices,
    },
  ]);

  return selection;
}

/**
 * Prompt the user for a text input.
 *
 * In non-interactive environments, returns the default value or throws.
 */
export async function promptInput(message: string, defaultValue?: string): Promise<string> {
  if (isNonInteractive()) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(
      `Cannot prompt in non-interactive mode and no default provided for: ${message}`,
    );
  }

  const { value } = await inquirer.prompt<{ value: string }>([
    {
      type: "input",
      name: "value",
      message,
      default: defaultValue,
    },
  ]);

  return value;
}

/**
 * Prompt the user for a password (input is masked).
 *
 * In non-interactive environments, always throws since passwords
 * should not have defaults.
 */
export async function promptPassword(message: string): Promise<string> {
  if (isNonInteractive()) {
    throw new Error(`Cannot prompt for password in non-interactive mode: ${message}`);
  }

  const { password } = await inquirer.prompt<{ password: string }>([
    {
      type: "password",
      name: "password",
      message,
      mask: "*",
    },
  ]);

  return password;
}

/**
 * Prompt the user with a yes/no confirmation.
 *
 * In non-interactive environments, returns the default value (or false).
 */
export async function promptConfirm(message: string, defaultValue?: boolean): Promise<boolean> {
  if (isNonInteractive()) {
    return defaultValue ?? false;
  }

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: "confirm",
      name: "confirmed",
      message,
      default: defaultValue ?? false,
    },
  ]);

  return confirmed;
}
