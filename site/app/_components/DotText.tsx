import { matrixRuns } from "../glyphs";

interface DotTextProps {
  readonly id: string;
  readonly text: string;
  readonly label: string;
  readonly sub?: number;
  readonly pitch?: number;
  readonly size?: number;
  readonly on?: string;
  readonly off?: string;
  readonly className?: string;
}

export function DotText({
  id,
  text,
  label,
  sub = 3,
  pitch = 6,
  size = 2.4,
  on = "#9a9a9a",
  off = "#1a1a1a",
  className = "h-auto w-full",
}: DotTextProps) {
  const grid = matrixRuns(text, sub, pitch);
  return (
    <svg
      viewBox={`0 0 ${grid.width} ${grid.height}`}
      role="img"
      aria-label={label}
      className={className}
    >
      <title>{label}</title>
      <defs>
        <pattern id={`${id}-off`} width={pitch} height={pitch} patternUnits="userSpaceOnUse">
          <rect width={size} height={size} fill={off} />
        </pattern>
        <pattern id={`${id}-on`} width={pitch} height={pitch} patternUnits="userSpaceOnUse">
          <rect width={size} height={size} fill={on} />
        </pattern>
      </defs>
      <rect width={grid.width} height={grid.height} fill={`url(#${id}-off)`} />
      <path d={grid.runs} fill={`url(#${id}-on)`} />
    </svg>
  );
}
