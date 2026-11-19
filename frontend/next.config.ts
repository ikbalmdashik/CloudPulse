import type { NextConfig } from "next";

/** Where the NestJS API runs. The browser never calls it directly; see `rewrites`. */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  /**
   * `/api/*` is forwarded to the backend, so the app and the API share one
   * origin: no CORS setup, and the backend's httpOnly session cookie is set
   * for this site.
   */
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
};

export default nextConfig;
