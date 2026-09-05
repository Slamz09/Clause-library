import type { NextConfig } from "next";
import path from "path";

const isDev = process.env.NODE_ENV !== 'production';

// Content-Security-Policy
// 'unsafe-inline' on script-src: required by Next.js inline hydration scripts.
// 'unsafe-eval' is allowed only in development (Turbopack HMR).
// img-src includes blob: (Leaflet canvas) and the CARTO basemap tile host
// (both Leaflet maps load tiles from {s}.basemaps.cartocdn.com).
// connect-src covers Supabase REST/WebSocket and Upstash Redis.
// LLM provider API calls are server-side only and therefore not in connect-src.
const csp = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io",
  // Document viewers iframe PDFs from Supabase storage public URLs and from
  // local blob: object URLs (upload preview). Without an explicit frame-src,
  // these fall back to default-src 'self' and the viewers render blank.
  "frame-src 'self' blob: https://*.supabase.co",
  "object-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  // Prevent MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Disallow embedding in frames (defense against clickjacking)
  { key: 'X-Frame-Options', value: 'DENY' },
  // HSTS: enforce HTTPS for 2 years, include subdomains, allow preload
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Limit referrer information sent cross-origin
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable browser features not used by the app
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Content Security Policy
  { key: 'Content-Security-Policy', value: csp },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ['unpdf', 'mammoth'],
  allowedDevOrigins: ['192.168.0.207'],
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
