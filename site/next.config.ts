import type { NextConfig } from "next";

const API_ORIGIN = (process.env.ADE_API_ORIGIN ?? "https://ade-api.chele.bi").replace(/\/+$/, "");

const config: NextConfig = {
  agentRules: false,
  outputFileTracingIncludes: {
    "/\\[handle\\]/og.png": ["./assets/fonts/**/*"],
  },
  images: { unoptimized: true },
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/people", destination: "/community", permanent: true },
      { source: "/community/:handle", destination: "/:handle", permanent: true },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/:path*` }];
  },
};

export default config;
