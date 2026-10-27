# Λεξούλα — état du projet

Mis à jour le 26/10/2026. Document vivant : à mettre à jour à la fin de chaque session de travail
(voir `CLAUDE.md`). Décisions : `docs/DECISIONS.md`. Réglages des services : `docs/CONFIGURATION.md`.

## En bref
L'appli tourne en ligne sur **https://flepr.github.io/lexoula/**, en attendant le domaine `app.lexoula.gr`.
Connexion par Google opérationnelle. Le worker IA fonctionne : les 235 mots du cours sont enrichis
et deux textes ont été écrits. Le blocage principal est la **création du domaine lexoula.gr chez Gandi**
(commande du 22/10 ; le registre grec impose 6 jours, Gandi annonce le domaine actif le **29/10/2026**) : Brevo, les codes à 6 chiffres par e-mail
et la vérification de la marque chez Google en dépendent.

Objectif : mise en service pour le groupe Ομαδικό Β2 début novembre 2026, test jusqu'au 14/12/2026.

## Ce qui marche (vérifié le 24/10/2026)
| Brique | État |
|---|---|
| Appli web (GitHub Pages) | En ligne sur `flepr.github.io/lexoula/`, déploiement automatique OK |
| Base Supabase + règles de sécurité | Déployée (dernière migration : `20261026020000_batch_grants.sql`) |
| Worker IA (`claude-sonnet-5-5`) | Appelé chaque minute par pg_cron ; 235 mots prêts, 4 textes. Depuis le 26/10 : lots (API batch, −50 %) par défaut, traitement rapide au choix du staff, coûts enregistrés (`ai_usage`). Chaque texte est relu (job `proofread` : conjugaisons, accords) avant traduction |
| Connexion Microsoft | Fonctionne (comptes personnels et professionnels) |
| Connexion Google | Fonctionne ; l'écran Google affiche encore le domaine Supabase (marque non vérifiée) |
| Connexion par e-mail | Masquée (`EMAIL_MODE = "off"`) tant que Brevo n'est pas branché ; reviendra avec le code à 6 chiffres |
| Rôles | Admin automatique (compte Microsoft fabien@lepe.re, depuis le 24/10) ; rôle choisi dans la fiche « Modifier » ; suppression de comptes par l'admin dans l'appli ; l'admin nomme les professeurs |
| Espace professeur | Classes, invitations (lien, QR, code), listes, élèves ; renommer et déplacer ses élèves entre ses classes |
| Politique de confidentialité | `privacy.html`, en anglais et en grec |
| Classe de démonstration | « Δοκιμαστική τάξη », figée (copie de Β2 au 26/10), sans textes automatiques ; pour les proches de Fabien |
| Accès sur invitation | Un compte sans classe ne voit que l'écran du code (migration `20261025000000_invite_only.sql`) |
| Vitrine `lexoula.gr` | Construite (`site/`, 9 langues dont le grec) ; aperçu sur `flepr.github.io/lexoula/site/` |

## Bloqué ou en attente
| Sujet | Bloqué par | Prochaine action |
|---|---|---|
| Domaine `lexoula.gr` | Registre .gr (délai de 6 jours) | Actif le 29/10/2026 selon Gandi ; enchaîner DNS, Brevo, modèles d'e-mail le jour même |
| DNS : `app` → appli, `lexoula.gr` et `www` → vitrine, `contact@lexoula.gr` → me.com | Domaine | Voir `CONFIGURATION.md` § 2-3 (dont `APP_URL` dans `vite.config.js`) |
| Publication de la vitrine sur `lexoula.gr` | Domaine (29/10) | Étapes dans `CONFIGURATION.md` (§ Vitrine) : dépôt `flepr/lexoula-www`, workflow `site/www-pages.yml`, domaine `lexoula.gr` |
| Brevo (SMTP) puis modèles d'e-mail avec `{{ .Token }}` | Domaine (DNS) | Les modèles ne sont modifiables qu'après le SMTP ; ensuite passer `EMAIL_MODE` de `"off"` à `"code"` dans `src/views/login.js` |
| Vérification de la marque Google (« Connectez-vous à Λεξούλα ») | Domaine | Search Console (TXT), liens Branding vers `app.lexoula.gr`, demande de validation |
| Supabase URL Configuration définitive (`app.lexoula.gr`) | Domaine | À revoir avec le DNS |
| Sécurité des comptes GitHub et Supabase | Fabien | Finaliser les réglages convenus (détail dans le projet Claude) |
| Test par Στέφανος | — | Invité via Google ; à confirmer qu'il a le rôle professeur (sans rôle ni classe, il ne voit plus que l'écran du code) |

## Prochaines étapes (ordre proposé)
1. Débloquer le domaine, puis DNS, Brevo, modèles d'e-mail, URL Supabase, marque Google.
2. Sécurité des comptes.
3. ~~Progression de l'appli artifact~~ : importée le 24/10 dans le compte Microsoft (28 mots, 3 jours),
   par lien à usage unique (`src/importer.js`).
4. Notifications, à lancer à l'activation du domaine (29/10) : rappel de révision, nouveaux mots du cours,
   nouveaux textes (aussi importants l'un que l'autre ; notifications web, e-mail en secours).
   L'interface affiche « bientôt disponible ». Rien n'est encore construit : clés VAPID, table des
   abonnements, préférences et fuseau horaire, `sw.js`, réglages en 8 langues, envoi par pg_cron.
5. Mise en service pour le groupe Β2 : lien d'invitation envoyé par Στέφανος.
6. ~~Bascule de Fabien~~ : faite le 24/10. Appli artifact « Λεξιλόγιο Φοίβου » et ses deux tâches planifiées
   supprimées (sauvegarde zip remise à Fabien). Fabien révise désormais dans Λεξούλα.
7. Plus tard : connexion Apple, ouverture aux autres groupes (novembre ou début 2027).

## Petites dettes techniques
- Mode silencieux de l'iPhone : la voix du système reste muette sans écouteurs malgré la session audio
  « lecture » ; seul un rappel est affiché. Solution complète possible plus tard : fichiers audio générés
  côté serveur (lus par `<audio>`, qui passe outre le mode silencieux), au prix d'un service de synthèse vocale.
- GitHub Actions : `actions/checkout@v4` et `supabase/setup-cli@v1` visent Node 20 (forcés en Node 24) ; mettre à jour quand des versions plus récentes existent.
- Coûts IA : chaque appel est enregistré dans `ai_usage` (visible dans `diagnose.yml`) ; l'estimation affichée à l'import
  s'appuie sur ces mesures (repli : 0,0146 $ par mot et 0,07 $ par texte court relecture comprise, mesurés sur les 235 premiers mots).
- Mode batch vérifié le 26/10 avec un texte court (lot revenu en 4 min, 1,07 ¢ au lieu de 2,14 ¢) ; taux BCE à jour.
  Reste à voir un import de mots en lot (cache activé à partir de 4 paquets) au prochain cours.

## Échéances et maintenance
- Secret client Microsoft : expire le **24/10/2028** (Entra → Lexoula → Certificates & secrets ; en créer un nouveau et le coller dans Supabase → Azure).
- Projet Supabase gratuit : mis en pause après 7 jours sans activité (les appels du cron au worker devraient compter comme activité ; à confirmer pendant une période calme).
- Domaine `lexoula.gr` : renouvellement annuel chez Gandi.

## Journal
- **27/10/2026** — Exercice « Associe chaque mot à son sens » : les deux colonnes sont désormais une seule grille remplie ligne par ligne, toutes les cases à la hauteur de la plus haute ; une expression sur deux lignes ne décale plus les cases.
- **26/10/2026** — Textes : faute signalée par Fabien (« ήθελε να μεταφέρω » au lieu de « μεταφέρει »). Cause : le modèle reçoit les mots sous leur forme de dictionnaire et en recopiait parfois une, sans relecture. Consigne d'écriture renforcée (conjuguer et décliner) et nouvelle étape de relecture automatique entre l'écriture et la traduction : seuls des remplacements exacts, balises conservées, sont appliqués ; si la relecture échoue, le texte part quand même en traduction. Faute corrigée, textes déjà publiés relus une fois (sans retraduction ; copies de la classe de démonstration corrigées sans appel supplémentaire). Migration `20261026050000_proofread_texts.sql`.
- **26/10/2026** — Onglet Lecture et carte « texte du jour » : seuls les textes des classes dont on est membre s'affichent (sans classe, un prof voit ceux des classes qu'il enseigne). Avant, l'admin voyait aussi les copies de la classe de démonstration, d'où des textes en double. L'espace professeur continue de montrer les textes de chaque classe.
- **26/10/2026** — Notifications cadrées (décision dans `DECISIONS.md`) ; chantier reporté au 29/10, jour d'activation du domaine.
- **26/10/2026** — Aperçu de lien pour l'appli (Instagram, WhatsApp, iMessage) : balises Open Graph et image `og.png` (celle de la vitrine) dans `index.html` ; l'URL absolue vient de `APP_URL` dans `vite.config.js`, à passer à `app.lexoula.gr` avec le domaine.
- **26/10/2026** — Codes de classe : 6 lettres sans chiffres (sans I ni O) pour les nouvelles classes et le bouton « Nouveau code » (migration `20261026040000_short_invite_codes.sql`). Les deux codes existants (8 caractères, dont celui de la classe Β2 déjà partagé) sont conservés.
- **26/10/2026** — Classe de démonstration « Δοκιμαστική τάξη » (B2) pour les proches de Fabien : copie figée de la classe Β2 du jour (5 listes, 235 mots du dictionnaire partagé, 5 textes prêts copiés), textes automatiques désactivés, donc aucun appel à l'IA (migration `20261026030000_test_class.sql`). La classe Β2 continue de vivre normalement. `diagnose.yml` liste désormais les classes (mots, textes, membres).
- **26/10/2026** — Espace professeur : le nom grisé du formulaire « Nouvelle classe » est un exemple générique en grec, quelle que soit la langue de l'interface (« π.χ. Ομαδικό Τρίτης »), au lieu d'un nom de classe réel.
- **26/10/2026 (suite)** — Vitrine en grec (`/el/`, démo en anglais faute d'interface grecque), papier réglé
  retiré de l'accueil, en-tête resserré sur les petits iPhone, nouvelle image de partage. Workflow prêt pour le
  dépôt `flepr/lexoula-www` (`site/www-pages.yml`) ; publication reportée au 29/10.
- **26/10/2026** — Coûts de l'IA : traitement par lots (API batch, −50 %) par défaut, avec filet de sécurité
  à 2 h (annulation, résultats déjà prêts gardés, reste en direct). Cache des consignes automatique selon le
  nombre de requêtes. Consommation de chaque appel enregistrée (`ai_usage`). À l'import, estimation du coût
  en euros et option « traitement plus rapide » pour les profs et admins (migration `20261026000000_batch_costs.sql`).
  Essai réel (texte court « Ένα Σαββατοκύριακο στην Αράχωβα ») : défaut corrigé, les nouvelles tables n'étaient
  pas accessibles au worker (droits accordés une seule fois dans la migration initiale) ; le worker retrouve
  désormais un lot même si sa ligne de suivi manque. Penser à accorder les droits à chaque nouvelle table.
- **26/10/2026** — Accès réservé aux élèves d'une classe : nouvelle migration (`has_access()`, ajout de mots
  personnels, relance de liste et dictionnaire réservés aux membres d'une classe et au staff) et écran du code
  pour les comptes sans classe (quitter sa dernière classe y ramène). Vitrine `lexoula.gr` construite dans
  `site/` : entrée de dictionnaire en accueil, démo animée du téléphone (6 scènes), comment ça marche,
  fonctionnalités, espace professeur, crédits, coulisses (schéma d'architecture, outils, GitHub), 8 langues
  (pages `/fr/`, `/de/`…, redirection selon la langue du navigateur), polices auto-hébergées, image de partage
  `og.png`. Aperçu publié avec l'appli sous `/site/`. DNS revu dans `CONFIGURATION.md`.
- **25/10/2026** — Exercices d'écriture : la consigne devient le titre (grande, contrastée). Exercices de
  formes (aoriste, féminin, neutre) : étiquette de la forme, consigne, précision (personne, nombre), sens
  sous le mot, pronom ou article devant le champ (« εγώ », « η », « το » ; « εγώ καταδίκασα » accepté).
  Synthèse vocale : iOS ne dit pas au site si le mode silencieux est activé ; sur iPhone et iPad, un rappel
  « Pas de son ? » s'affiche à la première lecture de la journée, avec « Ne plus afficher ».
- **24/10/2026** — Gandi confirme le domaine pour le 29/10 (délai du registre grec). D'ici là, seule la
  connexion Google est ouverte aux élèves. Connexion Microsoft configurée et testée. Code de la classe
  affiché en grand à côté du QR dans l'espace professeur. Connexion par e-mail masquée en attendant Brevo.
  Admin passé au compte Microsoft (1 classe transférée ; ancien compte à supprimer par Fabien).
  Suggestion d'installer l'appli : étape d'onboarding, carte J+1 à J+21, entrée dans les réglages.
  Administration : liste des comptes en cartes (plus de défilement horizontal), rôle dans la fiche
  « Modifier », suppression définitive d'un compte avec case de confirmation. Progression de l'ancien
  compte admin (8 mots, 4 étoilés, 1 jour) fusionnée dans le compte Microsoft. Orthographe latine
  corrigée partout : Stefanos Vasileiou. Import ponctuel de progression par lien `#import=` (fusion sans
  perte, une seule application par lien). Appli personnelle « Λεξιλόγιο Φοίβου » et ses tâches planifiées
  supprimées après import (sauvegarde remise à Fabien). Textes : repères détaillés par niveau du CECRL
  (A1 à C2 : longueur, nombre de mots du vivier, grammaire, style) dans le worker.
  Soir : progression du compte élève de test (Google) fusionnée dans le compte principal (migration
  `20261024030000_merge_test_progress.sql`, même logique sans perte) ; compte de test vidé, à supprimer
  par Fabien depuis l'appli.
- **24/10/2026** — Travail transféré dans le projet Claude « Λεξούλα ». Mise en place du suivi
  (`CLAUDE.md`, `docs/ETAT.md`, `docs/DECISIONS.md`). Diagnostic : worker et cron sains.
- **23/10/2026** — v0.1 en ligne ; secrets GitHub, Pages, Supabase et Google configurés ; politique de
  confidentialité (EN, EL) ; crédit Στέφανος / Fabien ; aide clavier grec et option « sans écriture »
  pour la journée ; gestion des élèves par l'admin puis par les professeurs.
- **22/10/2026** — Décision de construire Λεξούλα ; nom validé par Στέφανος ; domaine commandé.
