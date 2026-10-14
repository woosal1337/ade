import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SocialCard } from "./_components/SocialCard";
import { UserSocialCard, type UserSocialCardProps } from "./_components/UserSocialCard";

export const SOCIAL_ALT =
  "ade: own your agent setup. Capture, share, import, plan, and apply one setup across 10 coding agents.";

async function font(name: string): Promise<ArrayBuffer> {
  const data = await readFile(join(process.cwd(), "assets", "fonts", name));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function fonts() {
  const [sans, sansExtended, mono] = await Promise.all([
    font("instrument-sans-400-latin.ttf"),
    font("instrument-sans-400-latin-ext.ttf"),
    font("ibm-plex-mono-500-latin.ttf"),
  ]);
  return [
    { name: "Instrument Sans", data: sans, weight: 400 as const, style: "normal" as const },
    { name: "Instrument Sans", data: sansExtended, weight: 400 as const, style: "normal" as const },
    { name: "IBM Plex Mono", data: mono, weight: 500 as const, style: "normal" as const },
  ];
}

export async function socialImage(width: number, height: number): Promise<ImageResponse> {
  return new ImageResponse(<SocialCard width={width} height={height} />, {
    width,
    height,
    fonts: await fonts(),
  });
}

export async function userSocialImage(
  props: Omit<UserSocialCardProps, "width" | "height">,
  headers: Record<string, string>,
): Promise<ImageResponse> {
  return new ImageResponse(<UserSocialCard width={1200} height={630} {...props} />, {
    width: 1200,
    height: 630,
    fonts: await fonts(),
    headers,
  });
}
