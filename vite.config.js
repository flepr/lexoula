import { defineConfig } from "vite";

// Adresse publique de l'appli, utilisée pour les aperçus de lien (Instagram, WhatsApp, iMessage…),
// qui exigent des URL absolues. Passer à "https://app.lexoula.gr/" une fois le domaine actif.
const APP_URL = process.env.APP_URL || "https://flepr.github.io/lexoula/";

export default defineConfig({
  base: "./",
  build: { target: "es2020", sourcemap: false },
  plugins: [
    {
      name: "app-url",
      transformIndexHtml: (html) => html.replaceAll("%APP_URL%", APP_URL),
    },
  ],
});
