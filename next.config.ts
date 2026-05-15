import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Fix workspace root detection - force turbopack to use this directory
  turbopack: {
    root: __dirname,
  },
  // Also ensure webpack uses correct context
  webpack: (config) => {
    config.context = __dirname;
    return config;
  },
};

export default nextConfig;
