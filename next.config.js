/** @type {import('next').NextConfig} */
const nextConfig = {
  // react-leaflet v4 ist nicht StrictMode-sicher (doppeltes Mounten im Dev ->
  // "Map container is already initialized"). StrictMode ist nur ein Dev-Hilfsmittel
  // ohne Produktionswirkung -> deaktiviert, damit die Karte sauber lädt.
  reactStrictMode: false,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
};

module.exports = nextConfig;
