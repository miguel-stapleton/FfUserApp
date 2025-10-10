/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: [
      'localhost',
      'images.squarespace-cdn.com',
      // Supabase Storage public URLs
      'gxuxddgafphasrfecfmo.supabase.co',
    ],
  },
}

module.exports = nextConfig
