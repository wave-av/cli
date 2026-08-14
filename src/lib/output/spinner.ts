import ora from "ora";
import type { Ora } from "ora";

export async function withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
  const spinner = ora(message).start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export function startSpinner(message: string): Ora {
  return ora(message).start();
}
