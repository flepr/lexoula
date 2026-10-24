# Λεξούλα — réglages à faire une seule fois

Toutes les clés secrètes vont dans les **secrets GitHub** ou dans le **tableau de bord Supabase**,
jamais dans le code ni dans une conversation.

Projet Supabase : `bffjndnxeynyoseryfzs` — URL de rappel pour Google et Microsoft :
`https://bffjndnxeynyoseryfzs.supabase.co/auth/v1/callback`

## 1. Secrets GitHub (déploiement automatique)

Dépôt `flepr/lexoula` → **Settings → Secrets and variables → Actions → New repository secret** :

| Nom | Où le trouver |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → avatar → **Account preferences → Access Tokens → Generate new token** (nom : `github-lexoula`) |
| `SUPABASE_DB_PASSWORD` | le mot de passe de la base choisi à la création du projet |
| `ANTHROPIC_API_KEY` | platform.claude.com → workspace **Lexoula** → **API Keys → Create Key** (voir § 8) |

Ensuite : onglet **Actions** → workflow **Supabase** → **Run workflow**. Il crée les tables,
installe le worker IA et lui transmet la clé Anthropic.

## 2. GitHub Pages

**Settings → Pages → Build and deployment → Source : GitHub Actions.**
Puis, une fois le DNS en place (§ 3) : **Custom domain** = `app.lexoula.gr` → Save → cocher **Enforce HTTPS**
(disponible quelques minutes après).

## 3. DNS chez Gandi (domaine lexoula.gr)

| Type | Nom | Valeur |
|---|---|---|
| CNAME | `app` | `flepr.github.io.` |

Et une **redirection web** (Gandi → Domaine → Redirections) : `lexoula.gr` et `www.lexoula.gr`
→ `https://app.lexoula.gr` (permanente, 301).

## 4. Supabase — connexion

**Authentication → URL Configuration**
- Site URL : `https://app.lexoula.gr`
- Redirect URLs : `https://app.lexoula.gr/**`, `https://flepr.github.io/lexoula/**` (tests avant le domaine) et `http://localhost:5173/**`

**Authentication → Sign In / Providers**
- **Email** : activé. « Confirm email » peut rester activé.
- **Google** : activé, coller *Client ID* et *Client secret* (voir § 5).
- **Azure** (Microsoft) : activé, coller *Application (client) ID* et la *valeur* du secret ;
  *Azure Tenant URL* : `https://login.microsoftonline.com/common` (voir § 6).

**Authentication → Emails → Templates** (modifiable seulement **après** le SMTP personnalisé ci-dessous) : remplacer le contenu des modèles **Confirm signup** et
**Magic Link** pour qu'ils contiennent le **code à 6 chiffres** (`{{ .Token }}`) :

Sujet : `Λεξούλα — {{ .Token }}`

```html
<div style="font-family:Georgia,serif;max-width:480px;margin:auto;padding:24px;color:#1B231E">
  <h1 style="color:#6A3E6D;font-weight:normal;margin:0 0 16px">Λεξούλα</h1>
  <p style="font-size:32px;letter-spacing:6px;font-family:monospace;margin:16px 0">{{ .Token }}</p>
  <p>EN — Your sign-in code. It expires in one hour.<br>
     FR — Ton code de connexion. Il expire dans une heure.<br>
     DE — Dein Anmeldecode. Er läuft in einer Stunde ab.<br>
     ES — Tu código de acceso. Caduca en una hora.<br>
     IT — Il tuo codice di accesso. Scade tra un'ora.<br>
     RU — Код для входа. Действует один час.<br>
     PL — Twój kod logowania. Wygasa za godzinę.<br>
     TR — Giriş kodun. Bir saat içinde geçerliliğini yitirir.</p>
  <p style="color:#5A665D;font-size:13px">Lessons by: Στέφανος Βασιλείου (Stefanos Vasileiou) · <a href="https://www.instagram.com/learngreekwithstefanos/" style="color:#6A3E6D">@learngreekwithstefanos</a><br>
     App by: Φοίβος Λεπέρ (Fabien Lepère) · <a href="https://www.instagram.com/flepr/" style="color:#6A3E6D">@flepr</a></p>
</div>
```

**Authentication → Emails → SMTP Settings** (après § 7) : activer le SMTP personnalisé
- Host `smtp-relay.brevo.com`, port `587`
- Username / Password : identifiants SMTP Brevo (clé SMTP)
- Sender email `noreply@lexoula.gr`, sender name `Λεξούλα`

Puis **Authentication → Rate Limits** : porter les e-mails à 100 par heure.

## 5. Google Cloud (connexion Google)

console.cloud.google.com → nouveau projet **Lexoula**
- **APIs & Services → OAuth consent screen** : External, nom « Λεξούλα », e-mail de contact,
  domaine autorisé `lexoula.gr` ; **sans logo** (sinon vérification longue) ; **Publish app**.
- **Credentials → Create credentials → OAuth client ID** : *Web application*
  - Authorized JavaScript origins : `https://app.lexoula.gr`
  - Authorized redirect URIs : `https://bffjndnxeynyoseryfzs.supabase.co/auth/v1/callback`

## 6. Microsoft Entra (connexion Microsoft)

portal.azure.com → **Microsoft Entra ID → App registrations → New registration**
- Nom « Lexoula » ; comptes : **tout annuaire d'organisation et comptes Microsoft personnels**
- Redirect URI (Web) : `https://bffjndnxeynyoseryfzs.supabase.co/auth/v1/callback`
- **Certificates & secrets → New client secret** (24 mois) — noter la date d'expiration :
  il faudra le renouveler.

## 7. Brevo (envoi des e-mails)

brevo.com → compte gratuit → **Senders, Domains & Dedicated IPs → Domains → Add a domain** `lexoula.gr`
→ ajouter chez Gandi les enregistrements DNS indiqués (DKIM, code Brevo, DMARC) → **Authenticate**.
**SMTP & API → SMTP** : générer une clé SMTP (à coller dans Supabase, § 4).

## 8. Anthropic

platform.claude.com (Claude Console, compte distinct de l'abonnement Claude) :
- **Settings → Billing** : acheter des crédits (5 $ suffisent pour commencer), sans recharge automatique.
- **Settings → Workspaces → Add Workspace** `Lexoula` → onglet **Limits** → plafond mensuel (ex. 10 $).
- Dans ce workspace, onglet **API Keys → Create Key** `lexoula-worker`, sans expiration →
  secret GitHub `ANTHROPIC_API_KEY` (§ 1).

## 9. Premier lancement

Se connecter avec le compte Microsoft **fabien@lepe.re** : ce compte devient administrateur
automatiquement (liste `admin_emails` de la table `app_config`, migration `20261024000000_admin_microsoft.sql`). Dans l'onglet **Τάξεις**, l'administrateur peut ensuite donner le rôle
« Professeur » à Στέφανος (après sa première connexion) et créer les classes.
