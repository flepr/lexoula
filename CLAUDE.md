# Λεξούλα — consignes pour Claude

Ce fichier est lu au début de chaque session de travail sur le dépôt. Il fixe la façon de travailler ;
l'état du projet est dans `docs/ETAT.md`, les décisions dans `docs/DECISIONS.md`.

## À chaque session
1. **Avant de commencer** : lire `docs/ETAT.md` (ce qui est en ligne, ce qui bloque, prochaines étapes)
   et, si la tâche touche un choix déjà tranché, `docs/DECISIONS.md`.
2. **Pendant** : un commit par changement cohérent, message clair en anglais (ligne de titre courte),
   poussé sur `main`. Le déploiement est automatique (voir plus bas) ; vérifier qu'il passe.
3. **À la fin** : mettre à jour `docs/ETAT.md` (rubriques concernées + une ligne dans le journal),
   ajouter à `docs/DECISIONS.md` toute décision nouvelle de Fabien, puis recopier `docs/ETAT.md`
   dans le document `claude/etat-du-projet.md` du projet Claude « Λεξούλα »
   (outil Projects : `project_write` avec `local_path: docs/ETAT.md`),
   pour que les conversations qui n'ouvrent pas le dépôt partent du même état.

## Règles fixes
- **Pas de licence** : le dépôt est public mais tous droits réservés. Ne jamais ajouter de fichier LICENSE.
- **Dépôt public** : rien sur la sécurité des comptes (2FA, durée des jetons) ni donnée personnelle
  au-delà de ce qui est déjà publié ; ces éléments vont dans les documents du projet Claude.
- **Aucun secret dans le code, les commits ou la conversation.** Les clés vont dans les secrets GitHub
  (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`) ou dans le tableau de bord
  Supabase. La clé Supabase publishable de `src/supabase.js` est publique par nature.
- **Données de l'appli artifact « Λεξιλόγιο Φοίβου »** (collections `progress` et `days`) : lecture seule,
  ne jamais les effacer.
- **Crédit** identique partout, Στέφανος en premier : « Lessons by: Στέφανος Βασιλείου (Stefanos Vasiliou)
  · @learngreekwithstefanos / App by: Φοίβος Λεπέρ (Fabien Lepère) · @flepr ».
- **Maintenance minimale** : Fabien ne veut pas maintenir l'appli dans la durée. Préférer les solutions
  qui tournent seules, sans échéance à surveiller ; signaler toute échéance inévitable dans `docs/ETAT.md`.
- Base de données : toute modification passe par une **nouvelle migration** datée dans
  `supabase/migrations/` (jamais de modification d'une migration déjà déployée), avec RLS.
- Les textes d'interface passent par `src/i18n.js`, dans les 8 langues (en, fr, de, es, it, ru, pl, tr).

## Dialogue avec Fabien
- En français. Il travaille souvent sur iPhone : réponses courtes, étapes numérotées pour les réglages
  qu'il doit faire lui-même (consoles Google, Microsoft, Supabase, Gandi, Brevo).
- Principes pédagogiques et décisions produit : `docs/DECISIONS.md`.

## Repères techniques
- Front : Vite + JavaScript sans framework (`src/`), publié sur GitHub Pages par `.github/workflows/web.yml`
  à chaque push hors `supabase/`, `docs/` et `*.md`. Chemins relatifs : marche sur
  `flepr.github.io/lexoula/` et sur `app.lexoula.gr`.
- Base, connexion, worker IA : Supabase, projet `bffjndnxeynyoseryfzs`, déployé par
  `.github/workflows/supabase.yml` (migrations, secret Anthropic, fonction `worker`).
- Diagnostic en lecture seule de la base (file IA, cron, appels au worker) :
  workflow `diagnose.yml`, lancé par `gh api -X POST repos/flepr/lexoula/actions/workflows/diagnose.yml/dispatches -f ref=main` ;
  résultats dans les annotations du job.
- Réglages des services externes : `docs/CONFIGURATION.md`.
