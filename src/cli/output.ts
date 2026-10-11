import { styleText } from "node:util";

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

export function createOutput(io: CliIO, colorAllowed: boolean): Output {
  const color = colorAllowed && io.stdoutIsTTY && io.env.NO_COLOR === undefined;
  return {
    color,
    style(style, text) {
      return color ? styleText(style, text) : text;
    },
    line(text = "") {
      io.stdout(`${text}\n`);
    },
    error(text = "") {
      io.stderr(`${text}\n`);
    },
  };
}

export function padEnd(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}
