export const GLYPH_ROWS = 7;

export const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
};

export interface Dot {
  readonly x: number;
  readonly y: number;
  readonly on: boolean;
}

export interface DotMatrix {
  readonly dots: readonly Dot[];
  readonly columns: number;
  readonly rows: number;
}

export function dotMatrix(text: string, sub: number): DotMatrix {
  const dots: Dot[] = [];
  let offset = 0;
  for (const char of text) {
    const glyph = GLYPHS[char];
    if (glyph === undefined) {
      continue;
    }
    const width = glyph[0]?.length ?? 0;
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < width; gx += 1) {
        const on = row[gx] === "#";
        for (let sy = 0; sy < sub; sy += 1) {
          for (let sx = 0; sx < sub; sx += 1) {
            dots.push({ x: (offset + gx) * sub + sx, y: gy * sub + sy, on });
          }
        }
      }
    });
    offset += width + 1;
  }
  return { dots, columns: Math.max(1, offset - 1) * sub, rows: GLYPH_ROWS * sub };
}

export interface MatrixRuns {
  readonly width: number;
  readonly height: number;
  readonly runs: string;
}

export function matrixRuns(
  text: string,
  sub: number,
  pitch: number,
  left = 0,
  top = 0,
): MatrixRuns {
  const matrix = dotMatrix(text, sub);
  const lit = new Set(matrix.dots.filter((dot) => dot.on).map((dot) => `${dot.x},${dot.y}`));
  let runs = "";
  for (let y = 0; y < matrix.rows; y += 1) {
    let x = 0;
    while (x < matrix.columns) {
      if (!lit.has(`${x},${y}`)) {
        x += 1;
        continue;
      }
      const first = x;
      while (x < matrix.columns && lit.has(`${x},${y}`)) {
        x += 1;
      }
      const width = (x - first) * pitch;
      runs += `M${left + first * pitch} ${top + y * pitch}h${width}v${pitch}h-${width}z`;
    }
  }
  return { width: matrix.columns * pitch, height: matrix.rows * pitch, runs };
}

export interface DotSvgOptions {
  readonly sub: number;
  readonly pitch: number;
  readonly size: number;
  readonly on: string;
  readonly off: string;
  readonly label: string;
  readonly background?: string;
  readonly padding?: number;
}

export function dotSvg(text: string, options: DotSvgOptions): string {
  const padding = options.padding ?? 0;
  const grid = matrixRuns(text, options.sub, options.pitch, padding, padding);
  const width = grid.width + padding * 2;
  const height = grid.height + padding * 2;
  const pattern = (id: string, fill: string): string =>
    `    <pattern id="${id}" x="${padding}" y="${padding}" width="${options.pitch}" height="${options.pitch}" patternUnits="userSpaceOnUse"><rect width="${options.size}" height="${options.size}" fill="${fill}"/></pattern>`;
  const background =
    options.background === undefined
      ? ""
      : `  <rect width="${width}" height="${height}" fill="${options.background}"/>\n`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${options.label}">\n  <title>${options.label}</title>\n  <defs>\n${pattern("off", options.off)}\n${pattern("on", options.on)}\n  </defs>\n${background}  <rect x="${padding}" y="${padding}" width="${grid.width}" height="${grid.height}" fill="url(#off)"/>\n  <path fill="url(#on)" d="${grid.runs}"/>\n</svg>\n`;
}
