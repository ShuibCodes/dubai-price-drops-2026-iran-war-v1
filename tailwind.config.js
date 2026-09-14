/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        rule: "var(--rule)",
        "rule-2": "var(--rule-2)",
        hot: "var(--hot)",
        amber: "var(--amber)",
        cyan: "var(--cyan)",
        live: "var(--live)",
        warn: {
          DEFAULT: "var(--warn)",
          wash: "var(--warn-wash)",
          edge: "var(--warn-edge)",
        },
        markup: {
          DEFAULT: "var(--markup)",
          wash: "var(--markup-wash)",
          edge: "var(--markup-edge)",
        },
        az: {
          DEFAULT: "var(--az)",
          hover: "var(--az-hover)",
          ink: "var(--az-ink)",
          wash: "var(--az-wash)",
          edge: "var(--az-edge)",
        },
        shell: "var(--shell)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        field: "var(--field)",
        hairline: "var(--hairline)",
        line: "var(--line)",
        "line-2": "var(--line-2)",
        "line-3": "var(--line-3)",
        "line-4": "var(--line-4)",
        fg: "var(--fg)",
        "fg-2": "var(--fg-2)",
        "fg-soft": "var(--fg-soft)",
        dim: "var(--dim)",
        faint: "var(--faint)",
        ghost: "var(--ghost)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        label: "0.16em",
      },
      spacing: {
        4.5: "1.125rem",
        5.5: "1.375rem",
        6.5: "1.625rem",
      },
      keyframes: {
        pop: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        pop: "pop .14s ease",
      },
    },
  },
  plugins: [],
};
