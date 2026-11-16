import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"` — Vercel manages the build output itself.
  // Type errors fail the build. Prisma types come from `prisma generate` (postinstall).
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // The admin sample-content loader reads the AI-generated demo images from
  // disk at runtime; keep both pools inside the serverless bundle.
  outputFileTracingIncludes: {
    '/api/admin/sample-content': ['./scripts/mockup-images/**/*', './scripts/mockup-dish-images/**/*'],
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), payment=()' },
          // Report-Only: violations show in the browser console but nothing is
          // blocked yet. Tighten and switch to `Content-Security-Policy` after
          // reviewing reports (Instagram/OpenStreetMap embeds need frame-src).
          {
            key: 'Content-Security-Policy-Report-Only',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; frame-src https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
