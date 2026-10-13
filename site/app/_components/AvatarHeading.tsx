import Image from "next/image";
import type { ReactNode } from "react";

interface AvatarHeadingProps {
  readonly src: string | null;
  readonly size: number;
  readonly children: ReactNode;
  readonly gap?: string;
  readonly eager?: boolean;
}

export function AvatarHeading({
  src,
  size,
  children,
  gap = "gap-4",
  eager = false,
}: AvatarHeadingProps) {
  return (
    <div className={`flex min-w-0 items-start ${gap}`}>
      <div
        className="relative shrink-0 overflow-hidden border border-line bg-raised"
        style={{ width: size, height: size }}
      >
        {src === null ? null : (
          <Image
            src={src}
            alt=""
            fill
            unoptimized
            sizes={`${size}px`}
            loading={eager ? "eager" : "lazy"}
            className="object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
