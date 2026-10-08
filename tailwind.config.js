import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        victory: { DEFAULT: "hsl(var(--victory))", foreground: "hsl(var(--victory-foreground))" },
        defeat:  { DEFAULT: "hsl(var(--defeat))",  foreground: "hsl(var(--defeat-foreground))" },
        draw:    { DEFAULT: "hsl(var(--draw))",    foreground: "hsl(var(--draw-foreground))" },
        side:    { ally: "hsl(var(--side-ally))",  enemy: "hsl(var(--side-enemy))" },
        rank:    { legendary: "hsl(var(--rank-legendary))", elite: "hsl(var(--rank-elite))", advanced: "hsl(var(--rank-advanced))" },
        "brand-soft": {
          DEFAULT: "hsl(var(--brand-soft))",
          foreground: "hsl(var(--brand-soft-foreground))",
        },
        panel: "hsl(var(--panel))",
        surface: {
          0: "hsl(var(--surface-0))",
          1: "hsl(var(--surface-1))",
          2: "hsl(var(--surface-2))",
          rail: "hsl(var(--surface-rail))",
        },
        // 导航轨（重设计 2026-09-21）：深色侧栏专用色组，见 index.css --nav-*
        nav: {
          bg: "hsl(var(--nav-bg))",
          hover: "hsl(var(--nav-hover))",
          active: "hsl(var(--nav-active-bg))",
          fg: "hsl(var(--nav-fg))",
          "fg-muted": "hsl(var(--nav-fg-muted))",
          "fg-active": "hsl(var(--nav-fg-active))",
          indicator: "hsl(var(--nav-indicator))",
        },
      },
      boxShadow: {
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
      },
      fontSize: {
        caption: ["13px", { lineHeight: "1.45" }],
        metric:  ["22px", { lineHeight: "1.2" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
