import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#090D16",
        panel: "#131B2E",
        line: "#1E293B",
        accent: { DEFAULT: "#3B82F6", soft: "#60A5FA", deep: "#1D4ED8" },
        ink: { DEFAULT: "#E2E8F0", muted: "#94A3B8", faint: "#64748B" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glass: "0 0 0 1px rgba(30,41,59,0.9), 0 20px 50px -20px rgba(0,0,0,0.8)",
        glow: "0 0 0 1px rgba(59,130,246,0.55), 0 0 24px -4px rgba(59,130,246,0.55)",
      },
      keyframes: {
        shimmer: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(100%)" } },
      },
      animation: { shimmer: "shimmer 1.4s ease-in-out infinite" },
    },
  },
  plugins: [],
};

export default config;
