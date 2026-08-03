import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Tunnel (cloudflared/ngrok) o'z domenidan so'raydi — Vite dev serveri
    // Host sarlavhasini tekshiradi va ruxsat berilmagan host'ni rad etadi.
    host: true,
    allowedHosts: true,
  },
  build: {
    // Mini App mobil internetda ochiladi: manba xaritalari bundle'ni
    // kattalashtiradi va foydalanuvchiga hech narsa bermaydi.
    sourcemap: false,
    target: "es2020",
  },
});
