import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_BRANDS, MODEL_BRANDS } from "../site/app/brands.ts";
import { dotMatrix, dotSvg } from "../site/app/glyphs.ts";
import { dotRuns, LOGO_LAYOUT } from "../site/app/raster.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FOOTER = { sub: 3, pitch: 6, size: 2.4, label: "ade" };

function favicon() {
  const grid = 9;
  const pitch = 4;
  const size = 3;
  const matrix = dotMatrix("a.", 1);
  const lit = new Set(matrix.dots.filter((dot) => dot.on).map((dot) => `${dot.x + 1},${dot.y}`));
  const rects = [];
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      const fill = lit.has(`${x},${y}`) ? "#ededed" : "#262626";
      rects.push(
        `  <rect x="${x * pitch + 0.5}" y="${y * pitch + 0.5}" width="${size}" height="${size}" fill="${fill}"/>`,
      );
    }
  }
  const box = grid * pitch;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}">\n  <title>ade</title>\n  <rect width="${box}" height="${box}" fill="#0b0b0b"/>\n${rects.join("\n")}\n</svg>\n`;
}

const THEMES = {
  dark: { on: "#e6edf3", off: "#262c36", text: "#e6edf3", muted: "#9198a1", line: "#3d444d" },
  light: { on: "#1f2328", off: "#e6e9ec", text: "#1f2328", muted: "#59636e", line: "#d1d9e0" },
};

function escapeXml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function strip(brands, theme, label) {
  const colors = THEMES[theme];
  const columns = 5;
  const cellWidth = 136;
  const cellHeight = brands.some((brand) => brand.provider) ? 124 : 112;
  const rows = Math.ceil(brands.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const font = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const parts = [];
  let offArea = "";
  let onRuns = "";
  brands.forEach((brand, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    const x = left + (cellWidth - 44) / 2;
    const y = top + 20;
    const grid = dotRuns(brand.paths, { ...LOGO_LAYOUT, x, y });
    offArea += `M${x} ${y}h${grid.width}v${grid.width}h-${grid.width}z`;
    onRuns += grid.runs;
    parts.push(
      `  <text x="${left + cellWidth / 2}" y="${top + 86}" fill="${colors.text}" font-family="${font}" font-size="12" text-anchor="middle">${escapeXml(brand.name)}</text>`,
    );
    if (brand.provider) {
      parts.push(
        `  <text x="${left + cellWidth / 2}" y="${top + 103}" fill="${colors.muted}" font-family="${font}" font-size="9.5" letter-spacing="0.6" text-anchor="middle">${escapeXml(brand.provider.toUpperCase())}</text>`,
      );
    }
  });
  const lines = [];
  for (let column = 1; column < columns; column += 1) {
    lines.push(`M${column * cellWidth} 0V${height}`);
  }
  for (let row = 1; row < rows; row += 1) {
    lines.push(`M0 ${row * cellHeight}H${width}`);
  }
  const { pitch, dot } = LOGO_LAYOUT;
  const pattern = (id, fill) =>
    `    <pattern id="${id}" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse"><rect width="${dot}" height="${dot}" fill="${fill}"/></pattern>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}">\n  <title>${label}</title>\n  <defs>\n${pattern("off", colors.off)}\n${pattern("on", colors.on)}\n  </defs>\n  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="${colors.line}"/>\n  <path fill="none" stroke="${colors.line}" d="${lines.join("")}"/>\n  <path fill="url(#off)" d="${offArea}"/>\n  <path fill="url(#on)" d="${onRuns}"/>\n${parts.join("\n")}\n</svg>\n`;
}

const HARNESS_LABEL = `Logos of the ${HARNESS_BRANDS.length} supported harnesses`;
const MODEL_LABEL = `Logos of ${MODEL_BRANDS.length} model families`;

const outputs = {
  "site/app/icon.svg": favicon(),
  "docs/assets/ade-logo-dark.svg": dotSvg("ade.", { ...FOOTER, on: "#ededed", off: "#262626" }),
  "docs/assets/ade-logo-light.svg": dotSvg("ade.", { ...FOOTER, on: "#1a1a1a", off: "#e6e6e6" }),
  "docs/assets/harnesses-dark.svg": strip(HARNESS_BRANDS, "dark", HARNESS_LABEL),
  "docs/assets/harnesses-light.svg": strip(HARNESS_BRANDS, "light", HARNESS_LABEL),
  "docs/assets/models-dark.svg": strip(MODEL_BRANDS, "dark", MODEL_LABEL),
  "docs/assets/models-light.svg": strip(MODEL_BRANDS, "light", MODEL_LABEL),
};

for (const [relative, content] of Object.entries(outputs)) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`Wrote ${relative}`);
}
