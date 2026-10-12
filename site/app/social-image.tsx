import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SocialCard } from "./_components/SocialCard";

export const SOCIAL_ALT =
  "ade: own your agent setup. Capture, share, import, plan, and apply one setup across 10 coding agents.";

async function font(name: string): Promise<ArrayBuffer> {
  const data = await readFile(join(process.cwd(), "assets", "fonts", name));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export async function socialImage(width: number, height: number): Promise<ImageResponse> {
  const [sans, mono] = await Promise.all([
    font("instrument-sans-400-latin.ttf"),
    font("ibm-plex-mono-500-latin.ttf"),
  ]);
  return new ImageResponse(<SocialCard width={width} height={height} />, {
    width,
    height,
    fonts: [
      { name: "Instrument Sans", data: sans, weight: 400, style: "normal" },
      { name: "IBM Plex Mono", data: mono, weight: 500, style: "normal" },
    ],
  });
}
