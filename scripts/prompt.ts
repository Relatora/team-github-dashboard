/**
 * Terminal prompts for the CLI scripts.
 *
 * Passwords are read here rather than taken as command line arguments, because
 * an argument is visible in shell history and in the process list of every
 * other user on the machine.
 */
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

// Control codes, compared numerically. Written as string escapes inside a
// switch these are easy to get subtly wrong and impossible to review by eye.
const CTRL_C = 3;
const CTRL_D = 4;
const BACKSPACE = 8;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const SPACE = 32;
const DELETE = 127;

export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Read a line with nothing echoed to the terminal.
 *
 * Uses raw mode and reads keypresses directly. The usual trick of monkey
 * patching a readline interface's write method also works, but it reaches into
 * private API that shifts between Node versions.
 */
export function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY) {
    // Piped input, for example from a test harness. There is no echo to
    // suppress, so fall back to a normal read.
    return prompt(question);
  }

  return new Promise((resolve, reject) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        const code = char.charCodeAt(0);

        if (code === LINE_FEED || code === CARRIAGE_RETURN || code === CTRL_D) {
          cleanup();
          resolve(value);
          return;
        }
        if (code === CTRL_C) {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (code === BACKSPACE || code === DELETE) {
          value = value.slice(0, -1);
          continue;
        }
        // Ignore the remaining control characters, such as arrow key sequences.
        if (code >= SPACE) value += char;
      }
    };

    stdin.on("data", onData);
  });
}
