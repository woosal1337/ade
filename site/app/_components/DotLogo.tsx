import { dotRuns, LOGO_LAYOUT, type ShapePath } from "../raster";

interface DotLogoProps {
  readonly id: string;
  readonly paths: readonly ShapePath[];
  readonly className?: string;
  readonly off?: string;
}

export function DotLogo({ id, paths, className = "h-11 w-11", off = "#1c1c1c" }: DotLogoProps) {
  const grid = dotRuns(paths, LOGO_LAYOUT);
  const { pitch, dot } = LOGO_LAYOUT;
  return (
    <svg viewBox={`0 0 ${grid.width} ${grid.width}`} aria-hidden="true" className={className}>
      <defs>
        <pattern id={`${id}-off`} width={pitch} height={pitch} patternUnits="userSpaceOnUse">
          <rect width={dot} height={dot} fill={off} />
        </pattern>
        <pattern id={`${id}-on`} width={pitch} height={pitch} patternUnits="userSpaceOnUse">
          <rect width={dot} height={dot} fill="currentColor" />
        </pattern>
      </defs>
      <rect width={grid.width} height={grid.width} fill={`url(#${id}-off)`} />
      <path d={grid.runs} fill={`url(#${id}-on)`} />
    </svg>
  );
}
