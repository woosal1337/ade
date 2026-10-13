import Link from "next/link";
import type { ComponentProps } from "react";

type SiteLinkProps = Omit<ComponentProps<"a">, "href"> & {
  readonly href: string;
  readonly prefetch?: boolean;
};

export function isSiteRoute(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api/");
}

export function SiteLink({ href, prefetch, ...props }: SiteLinkProps) {
  if (isSiteRoute(href)) {
    return <Link href={href} {...(prefetch === undefined ? {} : { prefetch })} {...props} />;
  }
  return <a href={href} {...props} />;
}
