/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework, and don't spend bytes on the header.
  poweredByHeader: false,
  compress: true,

  async headers() {
    return [
      {
        // The product is behind a login: keep it out of search results entirely.
        source: '/dashboard/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/og.png',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, immutable' }],
      },
      {
        source: '/logo.png',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, immutable' }],
      },
    ]
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:5000/api/:path*',
      },
      {
        source: '/socket.io/:path*',
        destination: 'http://127.0.0.1:5000/socket.io/:path*',
      },
    ]
  },
}

module.exports = nextConfig
