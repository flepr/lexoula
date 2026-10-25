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
| Base Supabase + règles de sécurité | Déployée (dernière migration : `20261025000000_invite_only.sql`) |
| Worker IA (`claude-sonnet-5-5`) | Appelé chaque minute par pg_cron ; 235 mots prêts, 2 textes, aucune erreur en file |
| Connexion Microsoft | Fonctionne (comptes personnels et professionnels) |
| Connexion Google | Fonctionne ; l'écran Google affiche encore le domaine Supabase (marque non vérifiée) |
| Connexion par e-mail | Masquée (`EMAIL_MODE = "off"`) tant que Brevo n'est pas branché ; reviendra avec le code à 6 chiffres |
| Rôles | Admin automatique (compte Microsoft fabien@lepe.re, depuis le 24/10) ; rôle choisi dans la fiche « Modifier » ; suppression de comptes par l'admin dans l'appli ; l'admin nomme les professeurs |
| Espace professeur | Classes, invitations (lien, QR, code), listes, élèves ; renommer et déplacer ses élèves entre ses classes |
| Politique de confidentialité | `privacy.html`, en anglais et en grec |
| Accès sur invitation | Un compte sans classe ne voit que l'écran du code (migration `20261025000000_invite_only.sql`) |
| Vitrine `lexoula.gr` | Construite (`site/`, 8 langues) ; aperçu sur `flepr.github.io/lexoula/site/` |

## Bloqué ou en attente
| Sujet | Bloqué par | Prochaine action |
|---|---|---|
| Domaine `lexoula.gr` | Registre .gr (délai de 6 jours) | Actif le 29/10/2026 selon Gandi ; enchaîner DNS, Brevo, modèles d'e-mail le jour même |
| DNS : `app` → appli, `lexoula.gr` et `www` → vitrine, `contact@lexoula.gr` → me.com | Domaine | Voir `CONFIGURATION.md` § 2-3 |
| Publication de la vitrine sur `lexoula.gr` | Dépôt `flepr/lexoula-www` à créer par Fabien | Créer le dépôt vide et le rattacher à Claude ; Claude y pousse `site/` et un workflow Pages ; domaine `lexoula.gr` |
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
4. Rappels quotidiens (notifications web, e-mail en secours) : l'interface affiche « bientôt disponible ».
5. Mise en service pour le groupe Β2 : lien d'invitation envoyé par Στέφανος.
6. ~~Bascule de Fabien~~ : faite le 24/10. Appli artifact « Λεξιλόγιο Φοίβου » et ses deux tâches planifiées
   supprimées (sauvegarde zip remise à Fabien). Fabien révise désormais dans Λεξούλα.
7. Plus tard : connexion Apple, ouverture aux autres groupes (novembre ou début 2027).

## Petites dettes techniques
- Mode silencieux de l'iPhone : la voix du système reste muette sans écouteurs malgré la session audio
  « lecture » ; seul un rappel est affiché. Solution complète possible plus tard : fichiers audio générés
  côté serveur (lus par `<audio>`, qui passe outre le mode silencieux), au prix d'un service de synthèse vocale.
- GitHub Actions : `actions/checkout@v4` et `supabase/setup-cli@v1` visent Node 20 (forcés en Node 24) ; mettre à jour quand des versions plus récentes existent.
- Coûts IA réels à relever dans la console Anthropic après les premières vraies listes (estimation : < 3 $/mois par classe).

## Échéances et maintenance
- Secret client Microsoft : expire le **24/10/2028** (Entra → Lexoula → Certificates & secrets ; en créer un nouveau et le coller dans Supabase → Azure).
- Projet Supabase gratuit : mis en pause après 7 jours sans activité (les appels du cron au worker devraient compter comme activité ; à confirmer pendant une période calme).
- Domaine `lexoula.gr` : renouvellement annuel chez Gandi.

## Journal
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
