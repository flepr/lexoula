import { defineConfig } from "vite";

// Adresse publique de l'appli, utilisée pour les aperçus de lien (Instagram, WhatsApp, iMessage…),
// qui exigent des URL absolues. L'ancienne adresse flepr.github.io/lexoula/ redirige vers celle-ci (GitHub Pages).
const APP_URL = process.env.APP_URL || "https://app.lexoula.gr/";

export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    sourcemap: false,
    // deux pages : l'appli et la page publique d'un texte partagé (t/?s=<code>)
    rollupOptions: { input: { main: "index.html", share: "t/index.html" } },
  },
  plugins: [
    {
      name: "app-url",
      transformIndexHtml: (html) => html.replaceAll("%APP_URL%", APP_URL),
    },
  ],
});
