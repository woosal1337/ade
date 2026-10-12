export type FillRule = "nonzero" | "evenodd";

export interface ShapePath {
  readonly d: string;
  readonly rule: FillRule;
}

type Point = readonly [number, number];

const CURVE_STEPS = 24;

class Scanner {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  #skip(): void {
    while (this.#index < this.#text.length && /[\s,]/.test(this.#text[this.#index] as string)) {
      this.#index += 1;
    }
  }

  done(): boolean {
    this.#skip();
    return this.#index >= this.#text.length;
  }

  command(): string | undefined {
    this.#skip();
    const char = this.#text[this.#index];
    if (char !== undefined && /[MmLlHhVvCcSsQqTtAaZz]/.test(char)) {
      this.#index += 1;
      return char;
    }
    return undefined;
  }

  hasNumber(): boolean {
    this.#skip();
    const char = this.#text[this.#index];
    return char !== undefined && /[-+.\d]/.test(char);
  }

  number(): number {
    this.#skip();
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.#text.slice(this.#index));
    if (match === null) {
      throw new Error(`The path has no number at index ${this.#index}.`);
    }
    this.#index += match[0].length;
    return Number(match[0]);
  }

  flag(): boolean {
    this.#skip();
    const char = this.#text[this.#index];
    if (char !== "0" && char !== "1") {
      throw new Error(`The path has no arc flag at index ${this.#index}.`);
    }
    this.#index += 1;
    return char === "1";
  }
}

function cubic(from: Point, c1: Point, c2: Point, to: Point, out: Point[]): void {
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const t = step / CURVE_STEPS;
    const u = 1 - t;
    out.push([
      u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
      u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1],
    ]);
  }
}

function quadratic(from: Point, control: Point, to: Point, out: Point[]): void {
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const t = step / CURVE_STEPS;
    const u = 1 - t;
    out.push([
      u * u * from[0] + 2 * u * t * control[0] + t * t * to[0],
      u * u * from[1] + 2 * u * t * control[1] + t * t * to[1],
    ]);
  }
}

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  const dot = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
  return sign * Math.acos(Math.max(-1, Math.min(1, dot)));
}

function arc(
  from: Point,
  radii: Point,
  rotation: number,
  large: boolean,
  sweep: boolean,
  to: Point,
  out: Point[],
): void {
  let rx = Math.abs(radii[0]);
  let ry = Math.abs(radii[1]);
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) {
    out.push(to);
    return;
  }
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const start = angleBetween(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angleBetween((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) {
    delta -= 2 * Math.PI;
  } else if (sweep && delta < 0) {
    delta += 2 * Math.PI;
  }
  const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 24)));
  for (let step = 1; step <= steps; step += 1) {
    const angle = start + (delta * step) / steps;
    const ex = rx * Math.cos(angle);
    const ey = ry * Math.sin(angle);
    out.push(step === steps ? to : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
}

export function flattenPath(d: string): Point[][] {
  const scanner = new Scanner(d);
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let position: Point = [0, 0];
  let start: Point = [0, 0];
  let lastControl: Point | undefined;
  let lastCommand = "";
  let command: string | undefined;
  while (!scanner.done()) {
    command =
      scanner.command() ?? (lastCommand === "M" ? "L" : lastCommand === "m" ? "l" : lastCommand);
    if (command === "" || ((command === "Z" || command === "z") && scanner.hasNumber())) {
      throw new Error("The path has a number without a command.");
    }
    const relative = command === command.toLowerCase();
    const abs = (x: number, y: number): Point =>
      relative ? [position[0] + x, position[1] + y] : [x, y];
    const upper = command.toUpperCase();
    let control: Point | undefined;
    if (upper === "Z") {
      if (current.length > 0) {
        subpaths.push(current);
      }
      current = [];
      position = start;
      lastCommand = command;
      lastControl = undefined;
      if (!scanner.done() && scanner.hasNumber()) {
        throw new Error("The path has a number without a command.");
      }
      continue;
    }
    if (upper !== "M" && current.length === 0) {
      current.push(position);
    }
    if (upper === "M") {
      if (current.length > 0) {
        subpaths.push(current);
      }
      position = abs(scanner.number(), scanner.number());
      start = position;
      current = [position];
    } else if (upper === "L") {
      position = abs(scanner.number(), scanner.number());
      current.push(position);
    } else if (upper === "H") {
      const x = scanner.number();
      position = [relative ? position[0] + x : x, position[1]];
      current.push(position);
    } else if (upper === "V") {
      const y = scanner.number();
      position = [position[0], relative ? position[1] + y : y];
      current.push(position);
    } else if (upper === "C" || upper === "S") {
      const c1: Point =
        upper === "C"
          ? abs(scanner.number(), scanner.number())
          : lastControl !== undefined && /[CcSs]/.test(lastCommand)
            ? [2 * position[0] - lastControl[0], 2 * position[1] - lastControl[1]]
            : position;
      const c2 = abs(scanner.number(), scanner.number());
      const to = abs(scanner.number(), scanner.number());
      cubic(position, c1, c2, to, current);
      control = c2;
      position = to;
    } else if (upper === "Q" || upper === "T") {
      const c: Point =
        upper === "Q"
          ? abs(scanner.number(), scanner.number())
          : lastControl !== undefined && /[QqTt]/.test(lastCommand)
            ? [2 * position[0] - lastControl[0], 2 * position[1] - lastControl[1]]
            : position;
      const to = abs(scanner.number(), scanner.number());
      quadratic(position, c, to, current);
      control = c;
      position = to;
    } else if (upper === "A") {
      const radii: Point = [scanner.number(), scanner.number()];
      const rotation = scanner.number();
      const large = scanner.flag();
      const sweep = scanner.flag();
      const to = abs(scanner.number(), scanner.number());
      arc(position, radii, rotation, large, sweep, to, current);
      position = to;
    } else {
      throw new Error(`The path command is not known: ${command}.`);
    }
    lastControl = control;
    lastCommand = command;
  }
  if (current.length > 0) {
    subpaths.push(current);
  }
  return subpaths;
}

interface Edge {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function edgesOf(subpaths: readonly Point[][]): Edge[] {
  const edges: Edge[] = [];
  for (const points of subpaths) {
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index] as Point;
      const b = points[(index + 1) % points.length] as Point;
      if (a[1] !== b[1]) {
        edges.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
      }
    }
  }
  return edges;
}

function insideRow(
  edges: readonly Edge[],
  y: number,
  xs: readonly number[],
  rule: FillRule,
): boolean[] {
  const crossings: { x: number; winding: number }[] = [];
  for (const edge of edges) {
    const up = edge.y0 <= y && edge.y1 > y;
    const down = edge.y1 <= y && edge.y0 > y;
    if (up || down) {
      const t = (y - edge.y0) / (edge.y1 - edge.y0);
      crossings.push({ x: edge.x0 + t * (edge.x1 - edge.x0), winding: up ? 1 : -1 });
    }
  }
  crossings.sort((left, right) => left.x - right.x);
  const result: boolean[] = [];
  let next = 0;
  let winding = 0;
  let count = 0;
  for (const x of xs) {
    while (next < crossings.length && (crossings[next] as { x: number }).x < x) {
      winding += (crossings[next] as { winding: number }).winding;
      count += 1;
      next += 1;
    }
    result.push(rule === "evenodd" ? count % 2 === 1 : winding !== 0);
  }
  return result;
}

export interface Coverage {
  readonly size: number;
  readonly values: readonly number[];
}

export function coverage(
  paths: readonly ShapePath[],
  viewBox: number,
  size: number,
  samples = 4,
): Coverage {
  const shapes = paths.map((path) => ({ edges: edgesOf(flattenPath(path.d)), rule: path.rule }));
  const cell = viewBox / size;
  const xs: number[] = [];
  for (let column = 0; column < size; column += 1) {
    for (let sx = 0; sx < samples; sx += 1) {
      xs.push((column + (sx + 0.5) / samples) * cell);
    }
  }
  const values = new Array<number>(size * size).fill(0);
  for (let row = 0; row < size; row += 1) {
    for (let sy = 0; sy < samples; sy += 1) {
      const y = (row + (sy + 0.5) / samples) * cell;
      const hit = new Array<boolean>(xs.length).fill(false);
      for (const shape of shapes) {
        insideRow(shape.edges, y, xs, shape.rule).forEach((inside, index) => {
          hit[index] = hit[index] === true || inside;
        });
      }
      hit.forEach((inside, index) => {
        if (inside) {
          const column = Math.floor(index / samples);
          values[row * size + column] =
            (values[row * size + column] ?? 0) + 1 / (samples * samples);
        }
      });
    }
  }
  return { size, values };
}

export interface DotLayout {
  readonly size: number;
  readonly pitch: number;
  readonly dot: number;
  readonly threshold: number;
  readonly x?: number;
  readonly y?: number;
}

export interface DotRuns {
  readonly width: number;
  readonly runs: string;
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function dotRuns(paths: readonly ShapePath[], layout: DotLayout): DotRuns {
  const grid = coverage(paths, 24, layout.size);
  const left = layout.x ?? 0;
  const top = layout.y ?? 0;
  let runs = "";
  for (let row = 0; row < layout.size; row += 1) {
    let column = 0;
    while (column < layout.size) {
      if ((grid.values[row * layout.size + column] ?? 0) < layout.threshold) {
        column += 1;
        continue;
      }
      const first = column;
      while (
        column < layout.size &&
        (grid.values[row * layout.size + column] ?? 0) >= layout.threshold
      ) {
        column += 1;
      }
      const width = (column - first) * layout.pitch;
      runs += `M${round(left + first * layout.pitch)} ${round(top + row * layout.pitch)}h${round(width)}v${round(layout.pitch)}h-${round(width)}z`;
    }
  }
  return { width: layout.size * layout.pitch, runs };
}

export const LOGO_LAYOUT: DotLayout = { size: 22, pitch: 2, dot: 1.5, threshold: 0.45 };
