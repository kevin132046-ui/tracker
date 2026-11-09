import type { NextConfig } from 'next';

// Browser protections on every response: the site may not be framed by other sites (clickjacking),
// only the origin goes out as the referrer, declared content types are taken as given, and device
// features the site never uses (camera, microphone, location, payments, USB and the like) stay off
// for it and anything it loads.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
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
