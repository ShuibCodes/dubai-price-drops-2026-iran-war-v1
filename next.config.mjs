/** @type {import('next').NextConfig} */
const nextConfig = {
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
