// pdfkit loads its built-in fonts with dynamic requires that the bundler's
// file tracing cannot see, so they must be listed for the PDF routes.
const pdfFonts = ["./node_modules/pdfkit/package.json", "./node_modules/pdfkit/js/standard-fonts/**", "./node_modules/pdfkit/js/data/**"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // Server actions that build the PDF are bundled with the pages that call them,
  // so every route needs the fonts, not only the download routes.
  outputFileTracingIncludes: {
    "/**": pdfFonts,
  },
};
export default nextConfig;
