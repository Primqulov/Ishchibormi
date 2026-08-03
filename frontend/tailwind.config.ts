import type { Config } from "tailwindcss";

// Ranglar Figma "Ishchi Bormi — Web Dizayn" faylidagi o'zgaruvchilardan olingan
// (primary/blue, action/blue-light, accent/orange, text/ink, surface/bg, ...).
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#F2F6FF",
          100: "#E5EEFF", // bg/blue-50
          200: "#DCE9FF", // bg/blue-tint
          300: "#D3E4FE", // bg/blue-100
          400: "#5C8BFF",
          500: "#2F6BFF", // action/blue-light
          600: "#0038D8", // primary/blue
          700: "#002FB4",
          800: "#00248C",
          900: "#001A66",
          navy: "#0038D8",   // eski nom — Figma'dagi primary/blue
          navy700: "#002FB4",
          light: "#2F6BFF",
        },
        accent: {
          50:  "#FFF6E9",
          100: "#FFEED4", // status/warning-bg
          200: "#FFDCA6",
          300: "#FFC670",
          400: "#FFB13D",
          500: "#FF9500", // accent/orange
          600: "#D97C00",
          700: "#8A5300", // text/orange-dark
          amber: "#FF9500",
          amberBg: "#FFEED4",
          amberText: "#8A5300",
        },
        ink: {
          DEFAULT: "#0B1C30", // text/ink
          muted:   "#434655", // text/muted
          light:   "#737686", // text/muted-light
        },
        tg: { blue: "#2F6BFF", darkBlue: "#0038D8" },
        success: { DEFAULT: "#1A7F3C", bg: "#DFF5E5" },
        pending: { DEFAULT: "#8A5300", bg: "#FFEED4" },
        danger:  { DEFAULT: "#D92D20", bg: "#FEE4E2" },
        info:    { DEFAULT: "#0038D8", bg: "#E5EEFF" },
      },
      borderRadius: {
        xs: "0.25rem", sm: "0.375rem", DEFAULT: "0.5rem",
        md: "0.5625rem",  // 9px  — nav item
        lg: "0.625rem",   // 10px — tugma / input
        xl: "0.75rem",    // 12px — panel
        "2xl": "1rem",    // 16px — karta
        "3xl": "1.25rem",
      },
      boxShadow: {
        sm:   "0 1px 2px rgba(10,28,48,0.04)",
        card: "0 2px 4px rgba(10,28,48,0.05)",
        pop:  "0 12px 28px -10px rgba(10,28,48,0.18), 0 2px 6px rgba(10,28,48,0.06)",
        blue: "0 6px 16px -6px rgba(0,56,216,0.45)",
        ring: "0 0 0 4px rgba(0,56,216,0.12)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        "fade-in":   { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "slide-up":  { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "scale-in":  { "0%": { opacity: "0", transform: "scale(0.96)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        "shimmer":   { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        "fade-in":  "fade-in 200ms ease-out",
        "slide-up": "slide-up 240ms ease-out",
        "scale-in": "scale-in 180ms ease-out",
        "shimmer":  "shimmer 1.5s linear infinite",
      },
      fontFamily: {
        sans: [
          "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI",
          "Roboto", "Helvetica Neue", "Arial", "sans-serif",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      maxWidth: {
        shell: "1360px",
      },
    },
  },
  plugins: [],
};
export default config;
