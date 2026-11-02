# WODBurner

Chrono CrossFit (For Time, AMRAP, EMOM, Tabata), benchmarks, et scan d’un tableau. Tout tient dans le navigateur, sans compte. Seul le scan appelle le Worker.

## Installation

```bash
npm install
```

## Tests, build, taille

```bash
npm test
npm run build
npm run size
```

`npm run build` vérifie les types, écrit `dist/`, puis contrôle que le HTML contient déjà son texte. `npm run size` affiche la taille gzip de chaque fichier et s’arrête si un budget est dépassé.

## Développement

```bash
npm run dev
```

Le site est servi sur `http://127.0.0.1:4173`.

## Déploiement du site

Cloudflare Pages, branche du dépôt :

- Commande de build : `npm run build`
- Dossier de sortie : `dist`
- Variables : `SITE_ORIGIN` (`https://wodburner.app`), `WORKER_ORIGIN` (origine du Worker), `TURNSTILE_SITE_KEY` (clé publique Turnstile)

`public/_redirects` n’est pas la copie servie : le build écrit `dist/_headers`, `dist/_redirects`, `dist/robots.txt` et `dist/sw.js`.

## Worker

Depuis `worker/` :

```bash
npx wrangler kv namespace create WODBURNER
```

Collez l’identifiant dans `worker/wrangler.toml` (`[[kv_namespaces]]`, binding `KV`).

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler deploy
```

`GEMINI_API_KEY` et `TURNSTILE_SECRET` ne vont pas dans le dépôt ni dans `wrangler.toml`. Le modèle se règle avec la variable `GEMINI_MODEL` (défaut `gemini-2.5-flash`). `X-License` est accepté et ignoré.

## Repli GitHub Pages

```bash
BUILD_TARGET=github npm run build
```

Ce build ajoute `CNAME` et des pages de redirection avec `<meta http-equiv="refresh">` et `<link rel="canonical">` pour `/generate`, `/premium`, `/hall-of-fame`, `/open-stats` et leurs variantes `/fr/` et `/en/`. GitHub Pages n’applique pas `_headers` ni de vraies 301. Chaque page porte déjà une meta CSP. Il manque alors `frame-ancestors` et `Permissions-Policy`, qui ne vivent que dans l’en-tête.

## Budgets

JS initial d’une page de contenu ≤ 10 Ko gzip, page chrono ≤ 25 Ko, page scan ≤ 30 Ko, CSS ≤ 8 Ko, HTML+CSS+JS du premier chargement ≤ 100 Ko hors images.
