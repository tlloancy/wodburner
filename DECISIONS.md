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
- Un tableau avec un skill et un metcon devient deux WODs. Le format au premier niveau de la réponse reste celui du metcon. Le skill en 5×5 sans AMRAP, EMOM ou For Time reste un chrono libre, pas la durée du metcon.
- `Permissions-Policy` laisse `camera=(self)` pour la prise de photo du scan. Le reste est fermé.
- La langue affichée est celle du téléphone (`navigator.languages`). Pas de bouton ni de bandeau pour la changer. Un robot d’indexation reste sur l’adresse demandée, pour que `/fr/` et `/en/` restent lisibles. L’ancienne préférence `wb-lang` n’est plus lue.
- La synchro chiffre dans le navigateur (AES-GCM). Le Worker stocke le texte sous un identifiant dérivé de la clé, dans le même KV. `IP_HASH_SALT` (16 caractères au moins) est obligatoire pour le scan et pour les écritures de synchro. Sans lui, le Worker répond 503.
- La clé passe d’un appareil à l’autre par le partage du navigateur, ou par le code affiché sur l’historique. Le lien ne met la clé que dans le fragment (`#k=`), que le serveur ne reçoit pas. Sur un appareil qui a déjà sa clé, scanner une autre clé copie cet historique à côté du sien, sous le nom choisi par le copain. Rien n’est écrit dans sa sauvegarde. Un téléphone sans clé rejoint encore la sauvegarde, pour récupérer les siens.
- Il n’y a plus de champ `verified`, de fichier `TODO-VERIFY.md` ni de mention « à vérifier » sur les pages de benchmarks. Les définitions ont été comparées aux textes du CrossFit Journal (Benchmark Workouts, 2003, et The New Girls) : Angie, Barbara, Chelsea, Diane, Elizabeth, Grace, Helen, Isabel, Jackie, Karen, Mary et Nancy y correspondent. Annie et Kelly n’apparaissent pas dans ces textes : elles reprennent la définition la plus répandue. Fran, Cindy et Murph viennent du cahier des charges. Pour Linda, les sources ne donnent pas le même ordre des trois mouvements ; l’ordre retenu est deadlift, bench, clean.
- Amanda, Candy, Ellen, Eva, Gwen, Hope, Lynne, Maggie, Nicole, Andi, Barbara Ann, Freestyle Diane, GHD Annie, Grettel, Ingrid, Lane, Lyla, Marguerita, Nasty Girls, Partner Kelly, Power Amanda et Time Priority Angie reprennent le texte RX de crossfit.com/benchmark. Christine et Megan n’y ont pas de page.
- Les Heroes viennent du PDF officiel CrossFit « Hero Workouts » du 20 mai 2026, plus les pages benchmark pour Hidalgo, Santora, Ricky, Desforges et Rahoi, dont l’extraction du PDF avait mélangé les colonnes, et les pages parues ensuite : Gavin, Gunny, Owen, Partner Weston, Restrepo, TommyG3x. Murph garde le texte déjà en ligne.
- Filthy 50, Fight Gone Bad, The Chief, The Ghost, Tabata This, Tabata Something Else, L1 Benchmark, CrossFit Total, The Other Total et 2007 Hopper reprennent le texte RX de crossfit.com/benchmark. Ils sont dans la section Autre.
- Un texte de tableau collé est redécoupé avant lecture : `TC:20'` remplit le time cap, `EMOM 12'` remplit l’intervalle, `MAXIMUM 15'` aussi. L’historique affiche ce texte en lignes et relance le chrono qui correspond. For Time demande un temps, AMRAP des rounds et des reps.
- King Kong, Christine et Megan sont dans la section Funny. King Kong reprend le texte de Rudy Nielsen (2010) : 3 tours, 1 deadlift 455 lb, 2 muscle-ups, 3 squat cleans 250 lb, 4 handstand push-ups. Christine reprend la page CrossFit de septembre 2007 : 3 tours, 500 m au rameur, 12 deadlifts au poids de corps, 21 box jumps, boîte de 20 inch. Megan n’a pas de page CrossFit : 21-15-9 burpees, kettlebell swings 53/35 lb, double-unders.
- La fiche Karen indique la cible à 10 ft (3 m), donnée par le Journal. Isabel garde le texte classique, 30 arrachés à 135 lb (61 kg). L’encadré orange sous le texte dit Heavy Isabel à 100 kg, et la charge de compétition 2025 : 225 lb (102 kg) ou 155 lb (70 kg). Cette phrase n’entre pas dans le WOD enregistré.
