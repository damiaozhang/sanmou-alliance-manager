import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Future optimization: switch to @vitejs/plugin-react-swc for faster transforms
import path from "path";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2021",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "radix-vendor": ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-progress", "@radix-ui/react-scroll-area", "@radix-ui/react-select", "@radix-ui/react-separator", "@radix-ui/react-slot", "@radix-ui/react-tabs", "@radix-ui/react-tooltip"],
          "tanstack-vendor": ["@tanstack/react-virtual"],
          "lucide-vendor": ["lucide-react"],
        },
      },
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
