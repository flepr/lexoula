# Λεξούλα — état du projet

Mis à jour le 24/10/2026. Document vivant : à mettre à jour à la fin de chaque session de travail
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
| Base Supabase + règles de sécurité | Déployée (5 migrations, dernière : `20261023050000_teacher_students.sql`) |
| Worker IA (`claude-sonnet-5-5`) | Appelé chaque minute par pg_cron ; 235 mots prêts, 2 textes, aucune erreur en file |
| Connexion Google | Fonctionne ; l'écran Google affiche encore le domaine Supabase (marque non vérifiée) |
| Connexion par e-mail | Lien magique seulement, et réservé aux membres de l'organisation Supabase tant que Brevo n'est pas branché |
| Rôles | Admin automatique (fabien.lepere@me.com) ; l'admin nomme les professeurs |
| Espace professeur | Classes, invitations (lien, QR, code), listes, élèves ; renommer et déplacer ses élèves entre ses classes |
| Politique de confidentialité | `privacy.html`, en anglais et en grec |

## Bloqué ou en attente
| Sujet | Bloqué par | Prochaine action |
|---|---|---|
| Domaine `lexoula.gr` | Registre .gr (délai de 6 jours) | Actif le 29/10/2026 selon Gandi ; enchaîner DNS, Brevo, modèles d'e-mail le jour même |
| DNS : `app` → GitHub Pages, redirection `lexoula.gr`, `contact@lexoula.gr` → me.com | Domaine | Voir `CONFIGURATION.md` § 2-3 |
| Brevo (SMTP) puis modèles d'e-mail avec `{{ .Token }}` | Domaine (DNS) | Les modèles ne sont modifiables qu'après le SMTP |
| Vérification de la marque Google (« Connectez-vous à Λεξούλα ») | Domaine | Search Console (TXT), liens Branding vers `app.lexoula.gr`, demande de validation |
| Supabase URL Configuration définitive (`app.lexoula.gr`) | Domaine | À revoir avec le DNS |
| Connexion Microsoft | Fabien (Entra, puis Supabase) | Code prêt (fournisseur `azure`) ; reste l'inscription de l'appli dans Entra et l'activation dans Supabase (`CONFIGURATION.md` § 4 et 6) |
| Sécurité des comptes GitHub et Supabase | Fabien | Finaliser les réglages convenus (détail dans le projet Claude) |
| Test par Στέφανος | — | Invité via Google ; à confirmer qu'il s'est connecté et a le rôle professeur |

## Prochaines étapes (ordre proposé)
1. Débloquer le domaine, puis DNS, Brevo, modèles d'e-mail, URL Supabase, marque Google.
2. Connexion Microsoft (ou masquer le bouton) et sécurité des comptes.
3. Transférer la progression de Fabien depuis l'appli artifact (`progress`, `days`), en lecture seule côté artifact.
4. Rappels quotidiens (notifications web, e-mail en secours) : l'interface affiche « bientôt disponible ».
5. Mise en service pour le groupe Β2 : lien d'invitation envoyé par Στέφανος.
6. Bascule de Fabien : arrêter ou adapter les tâches planifiées de l'appli artifact
   (« Rappel vocabulaire grec » 7 h 08, « Textes grecs de la semaine » jeudi et dimanche 7 h 37).
7. Plus tard : connexion Apple, ouverture aux autres groupes (novembre ou début 2027).

## Petites dettes techniques
- GitHub Actions : `actions/checkout@v4` et `supabase/setup-cli@v1` visent Node 20 (forcés en Node 24) ; mettre à jour quand des versions plus récentes existent.
- Coûts IA réels à relever dans la console Anthropic après les premières vraies listes (estimation : < 3 $/mois par classe).

## Échéances et maintenance
- Secret client Microsoft : 24 mois maximum après sa création (date à noter ici).
- Projet Supabase gratuit : mis en pause après 7 jours sans activité (les appels du cron au worker devraient compter comme activité ; à confirmer pendant une période calme).
- Domaine `lexoula.gr` : renouvellement annuel chez Gandi.

## Journal
- **24/10/2026** — Gandi confirme le domaine pour le 29/10 (délai du registre grec). D'ici là, seule la
  connexion Google est ouverte aux élèves ; Fabien configure la connexion Microsoft.
- **24/10/2026** — Travail transféré dans le projet Claude « Λεξούλα ». Mise en place du suivi
  (`CLAUDE.md`, `docs/ETAT.md`, `docs/DECISIONS.md`). Diagnostic : worker et cron sains.
- **23/10/2026** — v0.1 en ligne ; secrets GitHub, Pages, Supabase et Google configurés ; politique de
  confidentialité (EN, EL) ; crédit Στέφανος / Fabien ; aide clavier grec et option « sans écriture »
  pour la journée ; gestion des élèves par l'admin puis par les professeurs.
- **22/10/2026** — Décision de construire Λεξούλα ; nom validé par Στέφανος ; domaine commandé.
