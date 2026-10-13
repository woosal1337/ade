import type { NextConfig } from "next";

const API_ORIGIN = (process.env.ADE_API_ORIGIN ?? "https://ade-api.chele.bi").replace(/\/+$/, "");

const config: NextConfig = {
  images: { unoptimized: true },
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/:path*` }];
  },
};

export default config;
