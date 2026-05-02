/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export is required — the i99dash host loads a bundle from a
  // CDN, not a Next.js server. No middleware, no dynamic routes, no
  // image optimisation server.
  output: 'export',
  // `next build` emits `./out` by default with `output: 'export'`.
  // `i99dash publish` tarballs whatever `sdk.config.json` points at.
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Only really needed for dev-server paths; no-op in exported output.
  reactStrictMode: true,
};

export default nextConfig;
