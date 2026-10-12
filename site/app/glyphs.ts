export const GLYPH_ROWS = 7;

export const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
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
  const matrix = dotMatrix(text, options.sub);
  const padding = options.padding ?? 0;
  const width = matrix.columns * options.pitch + padding * 2;
  const height = matrix.rows * options.pitch + padding * 2;
  const square = (dot: Dot): string =>
    `M${padding + dot.x * options.pitch} ${padding + dot.y * options.pitch}h${options.size}v${options.size}h-${options.size}z`;
  const off = matrix.dots
    .filter((dot) => !dot.on)
    .map(square)
    .join("");
  const on = matrix.dots
    .filter((dot) => dot.on)
    .map(square)
    .join("");
  const rects = `  <path fill="${options.off}" d="${off}"/>\n  <path fill="${options.on}" d="${on}"/>`;
  const background =
    options.background === undefined
      ? ""
      : `  <rect width="${width}" height="${height}" fill="${options.background}"/>\n`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${options.label}">\n  <title>${options.label}</title>\n${background}${rects}\n</svg>\n`;
}
