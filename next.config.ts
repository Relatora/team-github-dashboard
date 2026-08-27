import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Traced dependency bundle, so the Docker runtime image carries only what
  // the server actually imports.
  output: "standalone",
  /* config options here */
};

export default nextConfig;
