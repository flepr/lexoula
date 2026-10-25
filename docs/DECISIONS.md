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
- 24/10/2026 — L'administrateur supprime lui-même les comptes dans l'appli (avertissement explicite et case
  « je comprends que c'est définitif ») ; les classes du compte supprimé lui sont transférées. Le rôle
  (élève, professeur, administrateur) se choisit dans la fiche « Modifier », avec le nom et les classes.
- 23/10/2026 — L'option « sans exercices d'écriture » ne vaut que jusqu'à la fin de la journée.
- 24/10/2026 — Λεξούλα vient **en plus** de Quizlet pendant le test (pas en remplacement). Στέφανος
  communique par Instagram (informel) et par e-mail (liens Zoom, Quizlet du lendemain, ressources,
  annonces) : il pourra annoncer dans ses e-mails que les nouveaux mots sont dans Λεξούλα, avec le lien.
- 24/10/2026 — Installation sur l'écran d'accueil suggérée, jamais imposée : étape en fin d'onboarding,
  puis carte sur l'écran Aujourd'hui à J+1, J+3, J+7, J+14 et J+21, puis plus rien ; instructions
  toujours disponibles dans les réglages. Instructions iPhone / Android / ordinateur (QR code), ouvertes
  sur l'appareil détecté.

- 24/10/2026 — Fabien passe entièrement sur Λεξούλα : l'appli personnelle « Λεξιλόγιο Φοίβου » et ses
  tâches planifiées (rappel quotidien, textes du jeudi et du dimanche) sont supprimées, après import de sa
  progression.

- 25/10/2026 — Vitrine publique sur `lexoula.gr` (et `www`) : présente l'appli, rappelle les crédits et sert
  de vitrine des compétences de Fabien ; gros bouton vers `app.lexoula.gr`. Dans les 8 langues de l'appli,
  même identité visuelle que l'appli, section « Coulisses » (architecture, outils, lien GitHub),
  démo animée non interactive des principaux cas d'usage. Remplace la redirection `lexoula.gr` → appli.
- 25/10/2026 — Appli réservée aux élèves invités : un compte sans classe (ni professeur ni admin) ne voit que
  l'écran du code de classe et ne peut plus ajouter de mots personnels (donc aucun appel à l'IA).
  Les élèves d'une classe gardent la possibilité d'ajouter leurs propres mots.
- 26/10/2026 — Vitrine aussi en grec (9 langues : celles de l'appli + grec). La démo de la version grecque
  montre l'appli en anglais, puisque l'appli n'a pas d'interface grecque. Mention « développée avec Claude »
  conservée dans les coulisses. Pas de papier réglé en fond (les lignes ne tombaient pas sous le texte).
- 26/10/2026 — Publication de la vitrine sur `lexoula.gr` remise à l'activation du domaine (29/10/2026) ;
  d'ici là, l'aperçu `flepr.github.io/lexoula/site/` suffit.

## Pédagogie (préférences de Fabien, à suivre pour les exercices)
- Surtout des QCM ; quelques exercices d'écriture, mais pas trop.
- Pas de cartes retournables : grec et traduction visibles côte à côte, pour parcourir vite.
- Les accents font partie de l'orthographe.
- Exercices aussi sur les formes (aspect, temps, accords).
- Phrases à trous : leurres de même forme grammaticale que la réponse (même genre, nombre, cas ;
  même temps, personne, voix), même casse, faux par le sens. Règles détaillées dans le document
  « systeme-revision.md » du projet Claude.
- Textes : alterner courts et longs, thèmes variés (court après chaque liste et le jeudi, long le dimanche).
- 24/10/2026 — Textes adaptés au niveau de la classe, de A1 (phrases très courtes, présent, vocabulaire
  courant) à C2 (prose de niveau natif) : longueur, nombre de mots du vivier, grammaire et style par niveau.
- 25/10/2026 — Dans les exercices, la consigne est l'information principale : elle s'affiche en titre.
  Exercices de formes : étiquette de la forme, précision (personne, nombre), pronom ou article devant le champ.
- 25/10/2026 — iPhone en mode silencieux : rappel discret (au plus une fois par jour, « Ne plus afficher »)
  invitant à désactiver le mode silencieux ou à mettre des écouteurs.
- Rappel quotidien le matin ; usage surtout sur iPhone.
- Notes de vocabulaire : étymologie, familles de mots, faux amis.

## Connexion et comptes
- 22/10/2026 — Connexion par Google, Microsoft ou **code à 6 chiffres** par e-mail (pas de lien magique :
  il échoue dans une appli installée sur l'écran d'accueil de l'iPhone). Apple reportée (compte
  développeur payant, clé à renouveler).
- 24/10/2026 — Connexion par e-mail **masquée** tant que les e-mails ne partent pas (Brevo, après
  l'activation du domaine) ; elle reviendra directement avec le code à 6 chiffres (`EMAIL_MODE` dans
  `src/views/login.js`).
- 24/10/2026 — L'administrateur se connecte avec son compte Microsoft (`fabien@lepe.re`) ; l'ancien compte
  est supprimé, ses classes transférées au nouveau.
- 23/10/2026 — En attendant la vérification de la marque, on garde le bouton Google standard (écran Google
  qui affiche le domaine Supabase). Pas de domaine d'authentification payant chez Supabase.

## Juridique, crédit, code
- 22/10/2026 — Dépôt GitHub public **sans licence** (tous droits réservés).
- 23/10/2026 — Crédit identique partout, Στέφανος en premier, libellés traduits :
  « Lessons by: Στέφανος Βασιλείου (Stefanos Vasileiou) · @learngreekwithstefanos /
  App by: Φοίβος Λεπέρ (Fabien Lepère) · @flepr », pseudos liés à Instagram.
- 23/10/2026 — Politique de confidentialité en anglais et en grec seulement ; renvoi vers l'autorité de
  protection des données du pays de l'élève (exemple : Autorité hellénique), plus de mention de la CNIL ;
  contact `contact@lexoula.gr` (redirection à créer chez Gandi).

- 26/10/2026 — Les noms de classes s'écrivent en grec : l'exemple grisé du formulaire « Nouvelle classe » est en grec, quelle que soit la langue de l'interface.

- 26/10/2026 — Classe de démonstration « Δοκιμαστική τάξη » pour les amis et la famille de Fabien : figée (mots et textes de la classe Β2 au 26/10), aucun nouveau mot ni texte, aucun coût d'IA. La classe Β2 reste celle que Στέφανος alimente.

## Technique et exploitation
- 22/10/2026 — Le moins de maintenance possible : Fabien ne veut pas maintenir l'appli dans la durée.
- 23/10/2026 — Pile : Vite + JS sans framework sur GitHub Pages ; Supabase (base, connexion, pg_cron,
  fonction worker) ; Brevo pour les e-mails ; API Anthropic (modèle réglable par `ANTHROPIC_MODEL`).
- 23/10/2026 — Clé API du worker protégée par un plafond de dépenses mensuel sur un espace Anthropic dédié.
  Les choix de sécurité des comptes sont consignés dans le projet Claude, pas dans ce dépôt public.
- 24/10/2026 — Suivi du projet : `docs/ETAT.md` (état), ce journal, `CLAUDE.md` (consignes), avec copie
  de l'état dans le projet Claude « Λεξούλα ».
- 25/10/2026 — Vitrine : page statique sans dépendance (`site/`), polices auto-hébergées (aucune requête
  vers Google), source dans ce dépôt, publication sur un dépôt dédié `flepr/lexoula-www` (une seule
  adresse personnalisée par dépôt GitHub Pages) qui ne contient qu'un workflow (`site/www-pages.yml`) : il
  récupère ce dépôt public et construit la vitrine, sans secret ni jeton à renouveler ; relancé à la main après
  une modification de `site/`.
- 26/10/2026 — Coûts de l'IA : on garde Sonnet 5.5 et les 8 langues (la fiabilité des traductions prime).
  Les tâches passent par l'API batch d'Anthropic (−50 %, prêt en général en moins d'une heure) ; filet de
  sécurité : un lot non terminé au bout de 2 h est annulé, ce qui est déjà traité est gardé et le reste
  (non facturé) repasse en appels directs. Cache des consignes activé automatiquement seulement quand assez
  de requêtes les partagent (2 appels directs qui se suivent, 4 requêtes dans un lot) ; durée de 5 min.
- 26/10/2026 — À l'import de mots, les professeurs et admins voient une estimation discrète du coût en euros
  (mots nouveaux du dictionnaire partagé + texte court pour une classe) et peuvent cocher un traitement plus
  rapide (appels directs, surcoût affiché). Montants affichés uniquement en euros ; taux USD→EUR de la BCE,
  rafraîchi chaque jour par le worker. Les élèves ne voient ni le coût ni l'option.
