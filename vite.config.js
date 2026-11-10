import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// Numéro de version affiché dans « À propos » : une seule source, package.json.
// Correctif (1.8.x) : Claude l'incrémente seul. Mineure (1.x.0) ou majeure (x.0.0) : seulement avec l'accord de Fabien.
// Historique : docs/VERSIONS.md.
const APP_VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// Adresse publique de l'appli, utilisée pour les aperçus de lien (Instagram, WhatsApp, iMessage…),
// qui exigent des URL absolues. L'ancienne adresse flepr.github.io/lexoula/ redirige vers celle-ci (GitHub Pages).
const APP_URL = process.env.APP_URL || "https://app.lexoula.gr/";

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
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
