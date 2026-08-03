import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTelegram } from "./lib/telegram";
import "./index.css";

// Telegram SDK render'dan OLDIN ishga tushiriladi: mavzu (kun/tun) va oyna
// balandligi birinchi bo'yoqdayoq to'g'ri bo'lsin — aks holda ilova bir zumga
// oq fonda ko'rinib, keyin qorong'iga sakraydi.
initTelegram();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
