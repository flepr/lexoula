# Λεξούλα — journal des décisions

Décisions prises par Fabien (Φοίβος), datées. On ajoute en bas de la rubrique concernée ; une décision
remplacée reste visible, barrée ou suivie de « remplacée le … ».

## Produit et périmètre
- 22/10/2026 — Appli multi-élèves pour les cours de Στέφανος Βασιλείου (Chypre) : groupe B2 du lundi
  (pilote, jusqu'au 14/12/2026), C1 du mardi et cours individuels ensuite. Version web installable ;
  applis natives éventuellement plus tard.
- 22/10/2026 — Nom **Λεξούλα (Lexoula)**, validé par Στέφανος ; domaine `lexoula.gr` (Gandi), appli sur
  `app.lexoula.gr`, `lexoula.gr` redirige vers l'appli.
- 22/10/2026 — Fabien met l'appli gracieusement à disposition de Στέφανος. Frais d'IA payés par Fabien
  pendant le test (plafond mensuel), possiblement par Στέφανος ensuite.
- 22/10/2026 — Στέφανος fournit les mots en liste de texte simple (pas de PDF Quizlet).
- 22/10/2026 — 8 langues maternelles (interface et traductions) : en, fr, de, es, it, ru, pl, tr.
  Interface en anglais tant que l'élève n'a pas choisi sa langue ; aucune langue présélectionnée.
- 22/10/2026 — Traductions de l'IA publiées sans relecture (Στέφανος ne lit que l'anglais parmi les 8).
- 22/10/2026 — Progression visible du professeur par défaut ; chaque élève peut couper le partage.
- 22/10/2026 — Salutation d'accueil en grec, sans prénom (vocatif non déductible de façon fiable).
- 23/10/2026 — Un professeur peut renommer ses élèves et les déplacer entre **ses** classes ;
  l'administrateur peut tout faire.
- 23/10/2026 — L'option « sans exercices d'écriture » ne vaut que jusqu'à la fin de la journée.

## Pédagogie (préférences de Fabien, à suivre pour les exercices)
- Surtout des QCM ; quelques exercices d'écriture, mais pas trop.
- Pas de cartes retournables : grec et traduction visibles côte à côte, pour parcourir vite.
- Les accents font partie de l'orthographe.
- Exercices aussi sur les formes (aspect, temps, accords).
- Phrases à trous : leurres de même forme grammaticale que la réponse (même genre, nombre, cas ;
  même temps, personne, voix), même casse, faux par le sens. Règles détaillées dans le document
  « systeme-revision.md » du projet Claude.
- Textes : alterner courts et longs, thèmes variés (court après chaque liste et le jeudi, long le dimanche).
- Rappel quotidien le matin ; usage surtout sur iPhone.
- Notes de vocabulaire : étymologie, familles de mots, faux amis.

## Connexion et comptes
- 22/10/2026 — Connexion par Google, Microsoft ou **code à 6 chiffres** par e-mail (pas de lien magique :
  il échoue dans une appli installée sur l'écran d'accueil de l'iPhone). Apple reportée (compte
  développeur payant, clé à renouveler).
- 23/10/2026 — En attendant la vérification de la marque, on garde le bouton Google standard (écran Google
  qui affiche le domaine Supabase). Pas de domaine d'authentification payant chez Supabase.

## Juridique, crédit, code
- 22/10/2026 — Dépôt GitHub public **sans licence** (tous droits réservés).
- 23/10/2026 — Crédit identique partout, Στέφανος en premier, libellés traduits :
  « Lessons by: Στέφανος Βασιλείου (Stefanos Vasiliou) · @learngreekwithstefanos /
  App by: Φοίβος Λεπέρ (Fabien Lepère) · @flepr », pseudos liés à Instagram.
- 23/10/2026 — Politique de confidentialité en anglais et en grec seulement ; renvoi vers l'autorité de
  protection des données du pays de l'élève (exemple : Autorité hellénique), plus de mention de la CNIL ;
  contact `contact@lexoula.gr` (redirection à créer chez Gandi).

## Technique et exploitation
- 22/10/2026 — Le moins de maintenance possible : Fabien ne veut pas maintenir l'appli dans la durée.
- 23/10/2026 — Pile : Vite + JS sans framework sur GitHub Pages ; Supabase (base, connexion, pg_cron,
  fonction worker) ; Brevo pour les e-mails ; API Anthropic (modèle réglable par `ANTHROPIC_MODEL`).
- 23/10/2026 — Clé API du worker protégée par un plafond de dépenses mensuel sur un espace Anthropic dédié.
  Les choix de sécurité des comptes sont consignés dans le projet Claude, pas dans ce dépôt public.
- 24/10/2026 — Suivi du projet : `docs/ETAT.md` (état), ce journal, `CLAUDE.md` (consignes), avec copie
  de l'état dans le projet Claude « Λεξούλα ».
