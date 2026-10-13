import type { NextConfig } from "next";

const API_ORIGIN = (process.env.ADE_API_ORIGIN ?? "https://ade-api.chele.bi").replace(/\/+$/, "");

const config: NextConfig = {
  agentRules: false,
  images: { unoptimized: true },
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/people", destination: "/community", permanent: true }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/:path*` }];
  },
};

export default config;
