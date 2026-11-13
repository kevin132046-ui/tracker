import type { NextConfig } from 'next';

// Browser protections on every response: the site may not be framed by other sites (clickjacking),
// only the origin goes out as the referrer, declared content types are taken as given, and device
// features the site never uses (camera, microphone, location, payments, USB and the like) stay off
// for it and anything it loads.
//
// Content-Security-Policy: what the page may load and, above all, where it may send things. Everything
// comes from the site itself; the only other hosts are Google's two font hosts. So a script that got
// into the page some day (a bad dependency, an injection) could not fetch, post, beacon or load an
// image from anywhere else, and the portfolio stays on this origin.
// - script-src keeps 'unsafe-inline': the framework streams the page's data as inline scripts and the
//   layout has one boot script. No 'unsafe-eval' (the dev server needs it, so it is added there only).
// - style-src keeps 'unsafe-inline' for the style attributes charts and themes set.
// - img/media: this origin, plus data: and blob: for pictures and music picked on this device.
// - No upgrade-insecure-requests: the desktop app serves the same pages from http://127.0.0.1.
// A route that sets its own policy (the sandboxed /api/logo) keeps that one.
const development = process.env.NODE_ENV === 'development';
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src 'self'${development ? ' ws: wss:' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), display-capture=(), browsing-topics=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    // vinext's '/:path*' needs at least one path segment, so the page itself ('/') has its own rule.
    return [
      { source: '/', headers: securityHeaders },
      { source: '/:path*', headers: securityHeaders },
    ];
  },
};

export default nextConfig;
