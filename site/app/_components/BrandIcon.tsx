import type { ShapePath } from "../raster";

interface BrandIconProps {
  readonly paths: readonly ShapePath[];
  readonly className?: string;
}

export function BrandIcon({ paths, className = "h-4 w-4" }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      {paths.map((path) => (
        <path key={path.d} d={path.d} fillRule={path.rule} />
      ))}
    </svg>
  );
}
