const BIDI_CONTROLS = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

function isUnsafeCode(code: number, keepNewlines: boolean): boolean {
  if (keepNewlines && (code === 0x0a || code === 0x09)) {
    return false;
  }
  return (
    code < 0x20 ||
    code === 0x7f ||
    (code >= 0x80 && code <= 0x9f) ||
    BIDI_CONTROLS.has(code) ||
    INVISIBLE.test(String.fromCodePoint(code))
  );
}

export function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    if (isUnsafeCode(char.codePointAt(0) ?? 0, false)) {
      return true;
    }
  }
  return false;
}

export function printable(value: string, keepNewlines = false): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (!isUnsafeCode(code, keepNewlines)) {
      result += char;
    } else if (code === 0x0a) {
      result += "\\n";
    } else if (code === 0x09) {
      result += "\\t";
    } else if (code === 0x0d) {
      result += "\\r";
    } else if (code <= 0xff) {
      result += `\\x${code.toString(16).padStart(2, "0")}`;
    } else {
      result += `\\u{${code.toString(16)}}`;
    }
  }
  return result;
}

function isJsonUnsafe(code: number): boolean {
  return (code >= 0x7f && code <= 0x9f) || BIDI_CONTROLS.has(code);
}

export function escapeJsonControls(json: string): string {
  let result = "";
  for (const char of json) {
    const code = char.codePointAt(0) ?? 0;
    result += isJsonUnsafe(code) ? `\\u${code.toString(16).padStart(4, "0")}` : char;
  }
  return result;
}
