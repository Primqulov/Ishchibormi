/** @type {import('next').NextConfig} */

// Statik ikon/brend assetlari uchun cache — Google favicon uchun "barqaror URL"
// tavsiya qiladi. 7 kun cache + stale-while-revalidate: brauzer/CDN saqlaydi,
// lekin logo yangilansa bir hafta ichida tarqaladi (immutable EMAS — shu bois
// keyingi o'zgarish qotib qolmaydi).
const ICON_CACHE = "public, max-age=604800, stale-while-revalidate=86400";

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  async headers() {
    // Barcha root-darajadagi ikon fayllari (.png/.ico) + /img/ OG rasmlari.
    return [
      { source: '/:file([^/]+\\.ico)', headers: [{ key: 'Cache-Control', value: ICON_CACHE }] },
      { source: '/:file([^/]+\\.png)', headers: [{ key: 'Cache-Control', value: ICON_CACHE }] },
      { source: '/img/:path*', headers: [{ key: 'Cache-Control', value: ICON_CACHE }] },
    ];
  },
};
module.exports = nextConfig;
