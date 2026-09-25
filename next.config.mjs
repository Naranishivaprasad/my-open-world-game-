/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // R3F/Rapier: double-invoked effects duplicate physics bodies in dev
  // Large binary game assets are served from /public as static files; nothing to transform.
};

export default nextConfig;
