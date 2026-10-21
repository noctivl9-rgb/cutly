# DOSSIER X

> La vérité ne se trouve jamais au premier regard.

Plateforme web d'enquête criminelle collaborative pour jouer, autour d'une table et sur plusieurs téléphones, à une enquête physique augmentée : QR codes imprimés, personnages confidentiels, preuves partagées en temps réel, organisateur aux commandes.

Enquête fournie : **DOSSIER 001 — Le Mystère du Grand Hôtel** (3 à 6 joueurs, environ 2 h 30), entièrement jouable et résoluble.

## Démarrage local

Prérequis : Node.js 22.18 ou plus récent (24 recommandé). Aucune base à installer : en local, un vrai PostgreSQL embarqué (PGlite) stocke les données dans `data/pglite`.

```bash
npm install
```

```bash
cp .env.example .env
```

Renseignez `DX_ADMIN_EMAIL` et `DX_ADMIN_PASSWORD` dans `.env`, puis :

```bash
npm start
```

Ouvrez <http://localhost:3000>. Pour jouer sur plusieurs téléphones du même réseau, ouvrez `http://<ip-de-l-ordinateur>:3000` (la caméra intégrée exige HTTPS ; l'appareil photo natif du téléphone fonctionne dans tous les cas une fois le domaine public en place).

```bash
npm test
```

## Ce que fait l'application

| Espace | Rôle |
|---|---|
| Accueil | Créer, rejoindre ou reprendre une partie ; accès discret à l'administration |
| Création | Enquête, nombre de joueurs, attribution libre/automatique, unicité, progression, mode d'accusation, révélation, partage, cartes physiques, lancement |
| Salle d'attente | Titre, code `DX-XXXX`, QR d'invitation, joueurs, personnages pris, places, statut prêt |
| Joueur | ENQUÊTE (dossier commun, chronologies, notes, accusation, révélation) · EXPLORER (plan interactif de l'hôtel) · PREUVES (scanner, pièces) · TABLEAU (tableau d'enquête collaboratif) · PROFIL (mon personnage, secrets, partage) |
| Organisateur | Lancement, pause, fin, étapes, enveloppes, événements, annonces, réattribution, codes de récupération, accusation, révélation, vérité interne, export |
| Administration | Enquêtes versionnées (brouillon → publication), parties, QR codes PNG/SVG, planches PDF A4, contrôle des URL, journal d'audit, comptes |

## Architecture

```
src/
  server.ts            Routes HTTP (API + application)
  db.ts                PostgreSQL (DATABASE_URL) ou PGlite, migrations, transactions
  auth.ts              Jetons opaques (empreinte SHA-256 en base), mots de passe scrypt
  realtime.ts          Server-Sent Events + journal persistant pour le rattrapage
  http.ts              Routeur, en-têtes de sécurité, limitation de débit, statiques
  scenario/            Format d'enquête et scénario du Grand Hôtel
  services/
    scenarios.ts       Versions, publication, validation, registre des ressources QR
    games.ts           Parties, joueurs, progression, découvertes, scans, enveloppes, partage
    collab.ts          Tableau, notes, accusation (versions optimistes)
    state.ts           Vues filtrées joueur / organisateur (confidentialité)
    print.ts           QR PNG/SVG, PDF A4 vectoriel, contrôle des destinations
db/migrations/         Schéma SQL (contraintes, clés étrangères, index, RLS)
public/                Application web (modules JS sans étape de build), PWA
test/                  Tests de validation automatisés (serveur réel + PostgreSQL)
scripts/               Administrateur, sauvegarde, restauration, icônes
docs/                  Guides
```

**Choix techniques et écarts assumés par rapport à la pile recommandée** (Next.js, Supabase Auth/Realtime/Storage) :

- L'environnement de développement ne donnait accès ni à un projet Supabase ni à un PostgreSQL réseau. Le serveur est donc un serveur Node.js en TypeScript (exécuté nativement par Node, sans build), branché sur **n'importe quel PostgreSQL** via `DATABASE_URL` (Neon, Supabase, Render Postgres). En local et en test, le même SQL tourne sur PGlite (PostgreSQL 18 compilé en WebAssembly).
- **Authentification** : pas de comptes pour les joueurs (cas d'usage autour d'une table) mais des jetons opaques de 256 bits liés à une partie, avec code personnel de récupération ; jeton d'organisateur distinct du code de partie ; comptes administrateurs par mot de passe (scrypt) et sessions de 12 h.
- **Temps réel** : Server-Sent Events. Chaque événement est d'abord écrit en base (`game_events`) ; à la reconnexion, le client rejoue tout ce qui suit son dernier identifiant, puis recharge l'état depuis la base.
- **RLS** : activée sur toutes les tables sans aucune politique pour les rôles tiers ; seul le serveur (propriétaire des tables) y accède, ce qui neutralise par exemple l'API REST automatique de Supabase.
- **Stockage de fichiers** : le scénario fourni est entièrement vectoriel (portraits, plan, illustrations générés en SVG) et ses documents sont des données ; aucun fichier confidentiel n'est servi statiquement. Un stockage privé (Supabase Storage, S3) reste à brancher pour des enquêtes contenant des images téléversées — voir `docs/creer-une-enquete.md`.

## Documentation

- [Déploiement et domaine](docs/deploiement.md)
- [Guide d'administration et d'organisation](docs/administration.md)
- [Créer une enquête](docs/creer-une-enquete.md)
- [QR codes et impression](docs/qr-et-impression.md)
- [Sauvegarde et restauration](docs/sauvegarde.md)
- [Rapport de tests](TEST_REPORT.md)
