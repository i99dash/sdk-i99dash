/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the i99dash host loads a bundle from a CDN, not a
  // Next.js server. No middleware, no dynamic routes, no image
  // optimisation server.
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
};

export default nextConfig;
