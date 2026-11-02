# Décisions

Le dossier git est `wodburner/`. Le répertoire de travail reste celui qui le contient.

- `min` sur un EMOM est le nombre d’intervalles. `int` est la durée d’un intervalle en secondes. `?min=10&int=60` fait 10 × 60 s.
- Un For Time sans time cap s’ouvre avec `open=1`. `cap` est en secondes, comme `?cap=900`.
- Le Tabata compte le repos après chaque effort, y compris le dernier. Total = tours × (effort + repos), plus le repos entre blocs.
- Le format `other` ouvre un For Time (`open=1`), ou un AMRAP si `durationSec` est présent.
- Les anciennes adresses sans langue (`/generate`, `/premium`, `/hall-of-fame`, `/open-stats`) vont vers `/en/`, qui est le `x-default`. `/fr/...` et `/en/...` gardent leur langue. `/timers`, `/dashboard`, `/scan` et `/hero-wods` vont vers la même page en `/en/`.
- `connect-src` autorise aussi `https://challenges.cloudflare.com`. Le cahier des charges cite ce domaine pour `script-src` et `frame-src`. Le widget Turnstile l’appelle aussi en `connect-src`.
- La balise meta CSP est dans chaque page. L’en-tête Cloudflare répète la politique et ajoute `frame-ancestors`, qu’une meta ne peut pas imposer.
- `sw.js` est produit dans `dist/` au build, avec la liste des fichiers. Il n’est pas écrit à la main dans `public/`.
- Un cache d’image (SHA-256, 24 h) ne consomme pas le quota du jour. Turnstile reste exigé. Le compteur KV n’est pas transactionnel : le plafond est approximatif.
- `X-License` est lu et ignoré. Pas d’écran de licence en v1. Si `meta.license` contient une chaîne, le navigateur l’envoie.
- « Son » coupe l’oscillateur. La vibration part encore avec les bips.
- « Terminé » pendant la préparation annule et revient à l’état initial, sans résultat.
- L’import recalcule le hash. La fusion se fait sur ce hash. Normalisation : NFC, nom trimé, espaces internes resserrés, minuscules ; sauts de ligne unifiés et espaces en fin de ligne retirés.
- Le worker est prévu sur `https://scan.wodburner.app`. À confirmer.
- Pas de script d’audience dans les pages. Cloudflare peut compter les visites si l’option est active sur la zone. La page confidentialité le dit.
- L’éditeur affiché est Thomas Lloancy, contact thomaslloancy@gmail.com. La photo de scan est transmise à Google Gemini. Un humain doit relire cette page.
- Gemini reçoit `generationConfig.responseSchema` avec le schéma du §7.3, et l’image en `inline_data`, comme demandé. L’API documente aussi `responseJsonSchema`. Un appel réel doit confirmer que `responseSchema` est accepté.
- `Permissions-Policy` laisse `camera=(self)` pour la prise de photo du scan. Le reste est fermé.
- La page `/` utilise la langue enregistrée dans IndexedDB si elle existe, sinon `navigator.language`, sinon l’anglais.
