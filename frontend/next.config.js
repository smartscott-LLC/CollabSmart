/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001',
    NEXT_PUBLIC_NOVNC_URL: process.env.NEXT_PUBLIC_NOVNC_URL || 'http://localhost:6080/vnc.html',
  },
};

module.exports = nextConfig;
