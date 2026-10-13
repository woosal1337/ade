import Image from "next/image";
import type { ReactNode } from "react";

interface AvatarHeadingProps {
  readonly src: string | null;
  readonly children: ReactNode;
  readonly gap?: string;
}

export function AvatarHeading({ src, children, gap = "gap-4" }: AvatarHeadingProps) {
  return (
    <div className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] ${gap}`}>
      <div className="relative aspect-square h-full overflow-hidden border border-line bg-raised">
        {src === null ? null : (
          <Image src={src} alt="" fill unoptimized sizes="96px" className="object-cover" />
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
