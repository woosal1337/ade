import { randomBytes } from "node:crypto";
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
  plain(text: string): string;
  line(text?: string): void;
  error(text?: string): void;
}

const SGR: Record<Style, readonly [string, string]> = {
  bold: ["1", "22"],
  dim: ["2", "22"],
  red: ["31", "39"],
  green: ["32", "39"],
  yellow: ["33", "39"],
  cyan: ["36", "39"],
  gray: ["90", "39"],
};

const MARK_START = "\u0001";
const MARK_END = "\u0002";

function isStyle(value: string): value is Style {
  return Object.hasOwn(SGR, value);
}

export function terminalText(text: string, color: boolean, nonce = ""): string {
  const open = `${MARK_START}${nonce}`;
  let result = "";
  let plain = "";
  let index = 0;
  while (index < text.length) {
    if (nonce !== "" && text.startsWith(open, index)) {
      const end = text.indexOf(MARK_END, index + open.length);
      const tag = end === -1 ? "" : text.slice(index + open.length, end);
      const name = tag.slice(1);
      if ((tag.startsWith("o") || tag.startsWith("c")) && isStyle(name)) {
        result += printable(plain);
        plain = "";
        if (color) {
          result += `\u001b[${SGR[name][tag.startsWith("o") ? 0 : 1]}m`;
        }
        index = end + 1;
        continue;
      }
    }
    plain += text[index];
    index += 1;
  }
  return result + printable(plain);
}

export function createOutput(io: CliIO, colorAllowed: boolean): Output {
  const color = colorAllowed && io.stdoutIsTTY && io.env.NO_COLOR === undefined;
  const nonce = randomBytes(8).toString("hex");
  const mark = (kind: "o" | "c", style: Style): string =>
    `${MARK_START}${nonce}${kind}${style}${MARK_END}`;
  return {
    color,
    style(style, text) {
      return color ? `${mark("o", style)}${text}${mark("c", style)}` : text;
    },
    plain(text) {
      return terminalText(text, false, nonce);
    },
    line(text = "") {
      io.stdout(`${terminalText(text, color, nonce)}\n`);
    },
    error(text = "") {
      io.stderr(`${terminalText(text, color, nonce)}\n`);
    },
  };
}

export function padEnd(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}
