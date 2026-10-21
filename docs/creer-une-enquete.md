# Créer une enquête

## Versions

Une **enquête** (scénario) est réutilisable ; une **partie** en est une instance indépendante, liée à une **version publiée** précise.

- Une version publiée est **immuable**.
- Pour modifier une enquête : Administration → Enquêtes → **Nouveau brouillon** (copie de la dernière version), modifiez, puis **Publier**.
- Les parties déjà créées gardent leur version ; les nouvelles parties utilisent la dernière version publiée.
- La publication est refusée tant que la validation signale des incohérences (lieu inconnu, prérequis inexistant, coupable absent, mobile hors liste, etc.).

## Deux façons de créer

1. **Dans l'administration** : « Nouvelle enquête » (identifiant, numéro de dossier à 3 chiffres, titre), puis ajout des entités dans l'éditeur. Chaque entité s'édite en JSON.
2. **En code** (recommandé pour une enquête complète) : écrivez un fichier comme `src/scenario/grand-hotel.ts`, conforme au type `ScenarioDefinition` (`src/scenario/types.ts`), et importez-le au démarrage avec `importScenario(db, monEnquete, { publish: true })` dans `src/server.ts`.

## Entités

| Entité | Champs clés |
|---|---|
| Étapes | `idx`, `title`, `description`, `unlock` : `{type:'start'}`, `{type:'organizer'}`, `{type:'items', all:[...], among:[...], min:n}` |
| Lieux | `ref`, `name`, `stage` (étape d'accès), `public` : `qrKey` (adresse du QR), `description`, `hours`, `characters` |
| Personnages | `public` (visible par tous : présentation, relations, alibi déclaré, déplacements déclarés, portrait), `private` (visible du seul joueur : biographie, déplacements réels, secrets, motivations, objectifs, `shareable` partageables), `truth` (organisateur : `culprit`, `lies`) |
| Indices / témoignages / documents | `kind`, `type` (illustration : scene, objet, document, photo, rapport, temoignage), `location_ref`, `stage`, `discovery` : `modes` (`search` fouille, `qr` carte physique, `envelope`, `event`, `owner` document personnel), `requires`, `envelope`, `teaser` (visible avant découverte), `content` (`body`, `transcript`, `details`, `note`), `confidentiality` (`personnel` + `owner_character` pour un document personnel) |
| Enveloppes | `title`, `stage`, `teaser`, `content`, `unlocks` (éléments ajoutés au dossier à l'ouverture) |
| Événements | `title`, `body`, `unlocks` |
| Chronologie | `at_label` (heure fictive), `visibility` : `public`, `{type:'stage',stage}`, `{type:'item',ref}`, `{type:'envelope',ref}`, `{type:'truth'}` |
| Solution (informations) | `culprit`, `motive` (clé présente dans `intro.accusation.motives`), `motiveText`, `keyItems`, `contradictions`, `conclusion` (paragraphes), `itemRoles` |

## Règles d'écriture

- **Résolubilité** : chaque preuve clé doit être accessible sans carte physique (mode `search` ou `envelope`), pour que le jeu reste jouable sans impression ; les cartes `qr` seules apportent de la richesse, pas la solution.
- **Mensonges volontaires** : un personnage peut mentir dans `public.alibi` ; documentez le mensonge dans `truth.lies` et prévoyez la preuve qui le contredit.
- **Aucune contradiction involontaire** : vérifiez que les horaires des `realMovements` de tous les personnages sont compatibles entre eux et avec les preuves.
- **Confidentialité** : rien de `private`, `truth` ou `solution` n'est envoyé à un autre joueur ; un indice non découvert n'expose que son `teaser`. N'écrivez donc jamais d'information sensible dans un `teaser` ou une description publique.
- **Références stables** : les `ref` et `qrKey` deviennent des adresses de QR imprimés. Ne les renommez pas après impression.

## Images

Le scénario fourni n'utilise que des illustrations vectorielles générées. Pour des images téléversées confidentielles, ajoutez un stockage privé (Supabase Storage ou S3 avec URL signées de courte durée) et servez-les via une route qui applique les mêmes contrôles que `playerState` ; ne les placez jamais dans `public/`.
