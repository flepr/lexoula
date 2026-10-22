# Λεξούλα (Lexoula)

**Le vocabulaire de tes cours de grec, quelques minutes par jour.**

Λεξούλα est une application web (installable sur iPhone, Android et ordinateur) qui aide les élèves
à réviser le vocabulaire de leurs cours de grec moderne : listes par thème, sessions quotidiennes de
répétition espacée, phrases à trous, textes écrits pour chaque classe, interface en 8 langues
(anglais, français, allemand, espagnol, italien, russe, polonais, turc).

Conçue et réalisée par **Φοίβος Λεπέρ (Fabien Lepère)**, mise à disposition des cours de Στέφανος.

> © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
> Ce dépôt est public pour l'hébergement de l'application ; aucune licence de réutilisation n'est accordée.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/` | Appli web (Vite, JavaScript sans framework) |
| `public/` | Icônes, manifeste, service worker, domaine (`CNAME`) |
| `supabase/migrations/` | Schéma de la base, règles de sécurité (RLS), tâches planifiées |
| `supabase/functions/worker/` | Worker IA : traductions, exemples, leurres, textes |
| `.github/workflows/` | Déploiement automatique (GitHub Pages et Supabase) |
| `docs/CONFIGURATION.md` | Réglages à faire une fois (comptes, secrets, DNS) |

## Développement local

```bash
npm install
npm run dev
```
