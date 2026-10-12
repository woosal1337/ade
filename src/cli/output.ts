import { styleText } from "node:util";
import { printable } from "../core/text.ts";

export type Style = "bold" | "dim" | "red" | "green" | "yellow" | "cyan" | "gray";

export interface CliIO {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly prompt: (question: string) => Promise<string>;
  readonly readFile?: (file: string) => Promise<string>;
}

export interface Output {
  readonly color: boolean;
  style(style: Style, text: string): string;
  line(text?: string): void;
  error(text?: string): void;
}

const STYLE_CODES = new Set(["1", "2", "22", "31", "32", "33", "36", "39", "90"]);

export function terminalText(text: string, color: boolean): string {
  let result = "";
  let plain = "";
  let index = 0;
  while (index < text.length) {
    if (color && text.charCodeAt(index) === 0x1b && text[index + 1] === "[") {
      const end = text.indexOf("m", index + 2);
      if (end !== -1 && STYLE_CODES.has(text.slice(index + 2, end))) {
        result += printable(plain, true) + text.slice(index, end + 1);
        plain = "";
        index = end + 1;
        continue;
      }
    }
    plain += text[index];
    index += 1;
  }
  return result + printable(plain, true);
}

export function createOutput(io: CliIO, colorAllowed: boolean): Output {
  const color = colorAllowed && io.stdoutIsTTY && io.env.NO_COLOR === undefined;
  return {
    color,
    style(style, text) {
      return color ? styleText(style, text) : text;
    },
    line(text = "") {
      io.stdout(`${terminalText(text, color)}\n`);
    },
    error(text = "") {
      io.stderr(`${terminalText(text, color)}\n`);
    },
  };
}

export function padEnd(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}
