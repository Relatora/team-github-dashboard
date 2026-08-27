/**
 * Terminal prompts for the CLI scripts.
 *
 * Passwords are read here rather than taken as command line arguments, because
 * an argument is visible in shell history and in the process list of every
 * other user on the machine.
 */
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

/**
 * Buffered lines from a non-interactive stdin.
 *
 * When input is piped, stdin is read ONCE and the lines are handed out in
 * order. Creating a readline interface per prompt does not work here: closing
 * the first one ends the stream, so every later prompt resolves to nothing and
 * the script fails silently. Scripted account creation hit exactly that.
 */
let pipedLines: string[] | null = null;

async function readPipedLines(): Promise<string[]> {
  if (pipedLines) return pipedLines;

  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  pipedLines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  return pipedLines;
}

async function nextPipedLine(): Promise<string> {
  const lines = await readPipedLines();
  return lines.shift() ?? "";
}

export async function prompt(question: string): Promise<string> {
  if (!stdin.isTTY) {
    stdout.write(question);
    const value = await nextPipedLine();
    stdout.write("\n");
    return value.trim();
  }

  return new Promise((resolve, reject) => {
    stdout.write(question);
    readLine(resolve, reject, true);
  });
}

/**
 * Read a line with nothing echoed to the terminal.
 *
 * Uses raw mode and reads keypresses directly. Monkey patching a readline
 * interface's write method also works, but it reaches into private API that
 * shifts between Node versions.
 */
export async function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY) {
    // Piped input, for example from a provisioning script. There is no echo to
    // suppress, so the buffered reader handles it.
    stdout.write(question);
    const value = await nextPipedLine();
    stdout.write("\n");
    return value;
  }

  return new Promise((resolve, reject) => {
    stdout.write(question);
    readLine(resolve, reject, false);
  });
}

function readLine(
  resolve: (value: string) => void,
  reject: (error: Error) => void,
  echo: boolean
): void {
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
        if (value.length) {
          value = value.slice(0, -1);
          // Erase the echoed character, since raw mode does not do it.
          if (echo) stdout.write("\b \b");
        }
        continue;
      }
      // Ignore the remaining control characters, such as arrow key sequences.
      if (code >= SPACE) {
        value += char;
        if (echo) stdout.write(char);
      }
    }
  };

  stdin.on("data", onData);
}
