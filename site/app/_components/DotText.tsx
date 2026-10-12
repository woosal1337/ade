import { dotMatrix } from "../glyphs";

interface DotTextProps {
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
  text,
  label,
  sub = 3,
  pitch = 6,
  size = 2.4,
  on = "#9a9a9a",
  off = "#1a1a1a",
  className = "h-auto w-full",
}: DotTextProps) {
  const matrix = dotMatrix(text, sub);
  const width = matrix.columns * pitch;
  const height = matrix.rows * pitch;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={className}>
      <title>{label}</title>
      {matrix.dots.map((dot) => (
        <rect
          key={`${dot.x}-${dot.y}`}
          x={dot.x * pitch}
          y={dot.y * pitch}
          width={size}
          height={size}
          fill={dot.on ? on : off}
        />
      ))}
    </svg>
  );
}
