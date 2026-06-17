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
  // Sicherheits-Header für alle Routen. Die CSP ist bewusst eine verträgliche
  // Basis (erlaubt Karten-Tiles, Stripe, Fonts), liefert aber Clickjacking-,
  // base-uri- und object-src-Schutz. Geolocation bleibt für "Mein Standort" an.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https:",
      "form-action 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(self)" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
