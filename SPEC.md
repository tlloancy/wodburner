# WODBurner — spec v1

Chrono CrossFit (For Time, AMRAP, EMOM, Tabata), bibliothèque de benchmarks, scan d’un tableau blanc vers un chrono prêt. Navigateur seul, sans compte. L’historique est dans IndexedDB. Le scan et la copie chiffrée passent par le Worker Cloudflare.

Les écarts d’implémentation sont dans DECISIONS.md.

## Budgets

JS d’une page de contenu ≤ 10 Ko gzip, sauf l’historique ≤ 14 Ko. JS d’une page chrono ≤ 25 Ko. JS de la page scan ≤ 30 Ko. CSS ≤ 8 Ko gzip. Premier chargement hors images ≤ 100 Ko. Lighthouse mobile : Performance ≥ 95, Accessibilité, Bonnes pratiques et SEO à 100. LCP simulé 4G < 1,2 s. `npm run size` mesure les tailles gzip.

## Interdit

Firebase, Next.js, React (Preact seulement si le vanilla bloque), Tailwind, librairies de composants, polices web, vidéo, GIF, lodash, moment, date-fns, graphiques, images hotlinkées, images en base64 dans le stockage, `setInterval` pour compter le temps, `eval`, secret dans le dépôt, analytics à cookies.

## Routes

Chaque route existe en `/fr/` et `/en/`, sauf `/` et `/404.html`.

Index : `/`, `/{lang}/`, `/{lang}/timers/`, les quatre chronos, `/{lang}/hero-wods/`, chaque WOD, `/{lang}/privacy/`.

`noindex` : dashboard, scan, wod, 404.

`/generate`, `/premium`, `/hall-of-fame`, `/open-stats` et les variantes `/fr/` et `/en/` redirigent en 301 vers la racine de la langue. Sans langue, la cible est `/en/`.

Les adresses de l’ancien site sans langue vont vers l’anglais : `/timers`, `/timers/for-time`, `/timers/amrap`, `/timers/emom`, `/timers/tabata`, `/dashboard`, `/scan`, `/hero-wods` et `/hero-wods/{slug}` pour chaque fiche publiée.

## Données

`Format`, `TimerConfig`, `Result` et `Wod` sont dans `src/types.ts`. Le hash est le SHA-256 de name + format + text normalisés. IndexedDB `wodburner`, stores `wods` (clé `id`, index `createdAt`) et `meta`. `navigator.storage.persist()` après un enregistrement. Export `{version, exportedAt, wods}`. Import version 1, fusion par hash. La photo n’est pas stockée.

## Scan

Le navigateur décode, limite le grand côté à 1280 px sans agrandir, encode en WebP 0,75, retombe en JPEG 0,8 si le type n’est pas WebP, et refait une passe plus compressée si le fichier dépasse 150 Ko. Envoi binaire. Le Worker vérifie le type, 512 Ko, les octets magiques, Turnstile, 5 scans par IP et par jour, un plafond global, et un cache 24 h sur le SHA-256 de l’image. Gemini est appelé en REST avec `x-goog-api-key`, `inline_data`, `responseMimeType: application/json`, `responseSchema`, température 0. Un retry si le JSON est invalide. Timeout 20 s. Pas de journal d’image ni de texte. Si le tableau contient un skill et un metcon, la lecture renvoie les deux : le chrono de chacun est lu sur son propre texte. L’échauffement n’est pas un chrono.

## Synchro

Une clé de 32 caractères reste sur l’appareil. Elle sert à dériver l’identifiant de la sauvegarde et une clé AES-GCM. Le Worker ne reçoit que le texte chiffré, dans le même KV que le scan. 900 Ko maximum, 200 écritures par IP et par jour, expiration après 400 jours sans écriture. Une clé inconnue ne crée pas de sauvegarde vide.

## Chrono

Le temps vient d’horodatages (`performance.now()`), avec `startedAt` et `pausedTotal`. L’intervalle de 100 ms ne sert qu’à repeindre. Les états sont idle, prep, running, paused, finished. Les tests du §8.7 sont dans `src/engine/timer.test.ts`.
