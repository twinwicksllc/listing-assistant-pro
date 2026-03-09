import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'pwa-icon-192.png', 'pwa-icon-512.png'],
      workbox: {
        // Immediately activate new service worker versions
        skipWaiting: true,
        // Don't cache auth-related routes or OAuth callback routes
        navigateFallbackDenylist: [/^\/~oauth/, /^\/auth\//, /^\/ebay\//],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Force service worker to check for updates frequently
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'offline-cache',
              expiration: {
                maxEntries: 200,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: {
        name: "Teckstart Listing Assistant",
        short_name: "Teckstart",
        description: "AI-powered eBay listing creation for coins, bullion, and collectibles",
        theme_color: "#1d6fe0",
        background_color: "#f7f9fc",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));