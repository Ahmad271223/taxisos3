import type { Config } from "tailwindcss";

// Modern taxi palette: vivid yellow + stark white + deep navy.
const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
      },
      colors: {
        // Vivid taxi yellow – brand-500 is the dominant primary used in CTAs.
        brand: {
          50: "#FFFCEA",
          100: "#FFF6C9",
          200: "#FFEC8A",
          300: "#FFDE52",
          400: "#FFD12B",
          500: "#FFC400", // primary
          600: "#E6B000",
          700: "#B88A00",
          800: "#8A6700",
          900: "#5C4500",
        },
        ink: {
          50: "#F9FAFB",
          100: "#F3F4F6",
          200: "#E5E7EB",
          300: "#D1D5DB",
          400: "#9CA3AF",
          500: "#6B7280",
          600: "#4B5563",
          700: "#374151",
          800: "#1F2937",
          900: "#111827",
          950: "#0A0F1A",
        },
      },
      boxShadow: {
        soft: "0 6px 24px -10px rgba(17, 24, 39, 0.18)",
        card: "0 1px 2px rgba(17,24,39,.04), 0 10px 30px -16px rgba(17,24,39,.12)",
        glow: "0 12px 32px -10px rgba(255, 196, 0, 0.55)",
        float: "0 30px 80px -30px rgba(17,24,39,.45)",
        sheet: "0 -10px 40px -8px rgba(17, 24, 39, 0.18)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      keyframes: {
        floaty: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        pulseSoft: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: ".55" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        ping2: {
          "0%": { transform: "scale(1)", opacity: "0.8" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
      },
      animation: {
        floaty: "floaty 4s ease-in-out infinite",
        pulseSoft: "pulseSoft 2s ease-in-out infinite",
        ping2: "ping2 1.6s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
      backgroundImage: {
        "hero-yellow":
          "radial-gradient(70% 60% at 100% 0%, rgba(255,196,0,.35) 0%, rgba(255,196,0,0) 60%), radial-gradient(50% 50% at 0% 100%, rgba(255,196,0,.18) 0%, rgba(255,196,0,0) 60%)",
        "grid-soft":
          "linear-gradient(rgba(17,24,39,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(17,24,39,.04) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;
