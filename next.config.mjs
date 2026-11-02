/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "@sparticuz/chromium",
      "playwright",
      "sharp",
    ],
    outputFileTracingIncludes: {
      "/api/whatsapp": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    },
  },
  async redirects() {
    return [
      {
        source: "/live-updates",
        destination: "/deals",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/live-updates/vip-deal-1",
        destination: "/live-updates/vip-deal-1/index.html",
      },
    ];
  },
};

export default nextConfig;
