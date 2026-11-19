/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "pg"],
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};
export default nextConfig;
