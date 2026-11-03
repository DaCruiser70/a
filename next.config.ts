import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options",        value: "DENY" },
  { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
  {
    key:   "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*",     headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // The emailed set-password link: nothing leaks through Referer, caches or search engines.
      // Listed after the global rule so its Referrer-Policy wins.
      {
        source: "/set-password",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control",   value: "no-store" },
          { key: "X-Robots-Tag",    value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
