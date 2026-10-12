import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dotMatrix, dotSvg } from "../site/app/glyphs.ts";

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

const outputs = {
  "site/app/icon.svg": favicon(),
  "docs/assets/ade-logo-dark.svg": dotSvg("ade.", { ...FOOTER, on: "#ededed", off: "#262626" }),
  "docs/assets/ade-logo-light.svg": dotSvg("ade.", { ...FOOTER, on: "#1a1a1a", off: "#e6e6e6" }),
};

for (const [relative, content] of Object.entries(outputs)) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`Wrote ${relative}`);
}
