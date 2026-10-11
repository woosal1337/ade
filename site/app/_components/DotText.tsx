const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
};

const SUB = 3;
const PITCH = 6;

export function DotText({ text, label }: { text: string; label: string }) {
  const dots: { x: number; y: number; on: boolean }[] = [];
  let offset = 0;
  for (const char of text) {
    const glyph = GLYPHS[char];
    if (glyph === undefined) {
      continue;
    }
    const columns = glyph[0]?.length ?? 0;
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < columns; gx += 1) {
        const on = row[gx] === "#";
        for (let sy = 0; sy < SUB; sy += 1) {
          for (let sx = 0; sx < SUB; sx += 1) {
            dots.push({
              x: (offset + gx) * SUB * PITCH + sx * PITCH,
              y: gy * SUB * PITCH + sy * PITCH,
              on,
            });
          }
        }
      }
    });
    offset += columns + 1;
  }
  const width = Math.max(1, offset - 1) * SUB * PITCH;
  const height = 7 * SUB * PITCH;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full">
      <title>{label}</title>
      {dots.map((dot) => (
        <rect
          key={`${dot.x}-${dot.y}`}
          x={dot.x}
          y={dot.y}
          width="2.4"
          height="2.4"
          fill={dot.on ? "#9a9a9a" : "#1a1a1a"}
        />
      ))}
    </svg>
  );
}
