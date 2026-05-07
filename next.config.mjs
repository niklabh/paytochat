/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // WalletConnect / wagmi pull in some optional deps (pino-pretty, encoding) that
  // aren't actually needed at runtime. Silence the resolve warnings.
  webpack: (config) => {
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "pino-pretty": false,
      encoding: false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.googleusercontent.com" },
      { protocol: "https", hostname: "**.firebaseapp.com" },
    ],
  },
};

export default nextConfig;
