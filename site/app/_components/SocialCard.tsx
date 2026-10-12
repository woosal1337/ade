import { HARNESS_BRANDS } from "../brands";
import { dotSvg, matrixRuns } from "../glyphs";
import { dotRuns, LOGO_LAYOUT } from "../raster";

const COLORS = {
  ink: "#0b0b0b",
  line: "#222222",
  fg: "#ededed",
  muted: "#8f8f8f",
  off: "#171717",
  accent: "#7cf0b0",
};

const LOGO = { sub: 3, pitch: 4.2, size: 3 };
const STRIP_GAP = 24;

function dataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function harnessStrip(): { readonly svg: string; readonly width: number; readonly height: number } {
  const cell = LOGO_LAYOUT.size * LOGO_LAYOUT.pitch;
  let offArea = "";
  let onRuns = "";
  HARNESS_BRANDS.forEach((brand, index) => {
    const x = index * (cell + STRIP_GAP);
    const grid = dotRuns(brand.paths, { ...LOGO_LAYOUT, x, y: 0 });
    offArea += `M${x} 0h${grid.width}v${grid.width}h-${grid.width}z`;
    onRuns += grid.runs;
  });
  const width = HARNESS_BRANDS.length * cell + (HARNESS_BRANDS.length - 1) * STRIP_GAP;
  const pattern = (id: string, fill: string): string =>
    `<pattern id="${id}" width="${LOGO_LAYOUT.pitch}" height="${LOGO_LAYOUT.pitch}" patternUnits="userSpaceOnUse"><rect width="${LOGO_LAYOUT.dot}" height="${LOGO_LAYOUT.dot}" fill="${fill}"/></pattern>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${cell}" width="${width}" height="${cell}"><defs>${pattern("off", COLORS.off)}${pattern("on", COLORS.muted)}</defs><path fill="url(#off)" d="${offArea}"/><path fill="url(#on)" d="${onRuns}"/></svg>`;
  return { svg, width, height: cell };
}

interface SocialCardProps {
  readonly width: number;
  readonly height: number;
}

export function SocialCard({ width, height }: SocialCardProps) {
  const logo = matrixRuns("ade.", LOGO.sub, LOGO.pitch, 0, 0);
  const logoSvg = dotSvg("ade.", { ...LOGO, label: "ade", on: COLORS.fg, off: COLORS.off });
  const strip = harnessStrip();
  const scale = 1.1;
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        position: "relative",
        background: COLORS.ink,
        fontFamily: "Instrument Sans",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          display: "flex",
          border: `1px solid ${COLORS.line}`,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "76px 84px 72px",
        }}
      >
        <img alt="ade" src={dataUri(logoSvg)} width={logo.width} height={logo.height} />
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              fontSize: 82,
              lineHeight: 1,
              letterSpacing: -1.6,
              color: COLORS.fg,
            }}
          >
            Own your agent setup
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 29,
              lineHeight: 1.35,
              color: COLORS.muted,
            }}
          >
            Capture, share, import, plan, and apply one setup across 10 coding agents.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img
            alt="Logos of the supported harnesses"
            src={dataUri(strip.svg)}
            width={strip.width * scale}
            height={strip.height * scale}
          />
          <div
            style={{
              display: "flex",
              fontFamily: "IBM Plex Mono",
              fontSize: 26,
              color: COLORS.accent,
            }}
          >
            ade.chele.bi
          </div>
        </div>
      </div>
    </div>
  );
}
