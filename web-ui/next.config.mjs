import { randomBytes } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// `next dev` without AUTH_SECRET/ACCESS_PIN: pick one random value per run and
// share it through the environment, so API routes and the Edge middleware sign
// and verify sessions with the same secret. Production still requires both.
if (process.env.NODE_ENV !== 'production') {
  if (!process.env.AUTH_SECRET) process.env.AUTH_SECRET = randomBytes(32).toString('hex')
  if (!process.env.ACCESS_PIN && !process.env.GF_DEV_ACCESS_PIN) {
    process.env.GF_DEV_ACCESS_PIN = randomBytes(3).toString('hex')
    console.log(`\n  ➜ Dev login PIN: ${process.env.GF_DEV_ACCESS_PIN}  (set ACCESS_PIN in .env.local to choose your own)\n`)
  }
}
/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, '..'),
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }] }]
  },
}

export default nextConfig
