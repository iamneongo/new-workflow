/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow serving photos from the local public/photos directory
  images: {
    unoptimized: true,
  },
  // telegram package needs to run in Node.js server context (not Edge)
  serverExternalPackages: ['telegram'],
  // Fix workspace root warning when multiple lockfiles are detected
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
