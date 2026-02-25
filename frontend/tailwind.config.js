/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: "rgb(var(--cv-primary-rgb) / <alpha-value>)",
        accent: "rgb(var(--cv-accent-rgb) / <alpha-value>)",
        surface: "rgb(var(--cv-surface-rgb) / <alpha-value>)",
        ink: "rgb(var(--cv-ink-rgb) / <alpha-value>)",
      },
      fontFamily: {
        heading: ["Sora", "Segoe UI", "Tahoma", "sans-serif"],
        body: ["Source Sans 3", "Segoe UI", "Tahoma", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
      boxShadow: {
        brand: "0 16px 36px -22px rgba(13, 107, 253, 0.45)",
        panel: "0 12px 28px -20px rgba(15, 23, 42, 0.32)",
      },
      borderRadius: {
        brand: "14px",
      },
    },
  },
  plugins: [],
};

