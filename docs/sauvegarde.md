# Sauvegarde et restauration

## Sauvegarde

Sauvegarde logique complète (toutes les tables, en JSON), compatible PostgreSQL et PGlite :

```bash
npm run backup
```

Le fichier est écrit dans `backups/` (ou au chemin passé : `npm run backup -- /chemin/sauvegarde.json`). Il contient des empreintes de jetons et de mots de passe : stockez-le chiffré, hors du serveur.

- **PostgreSQL** : exécutez la commande avec `DATABASE_URL` défini, à tout moment (lecture seule). Complétez par les sauvegardes automatiques de l'hébergeur (Neon et Supabase proposent la restauration à un instant donné) ou `pg_dump` si vous l'avez.
- **PGlite (local)** : arrêtez d'abord le serveur (le répertoire est verrouillé), ou copiez simplement le dossier `data/pglite` serveur arrêté.

Fréquence conseillée : avant et après chaque séance de jeu, et avant toute publication de version.

## Restauration

La restauration s'effectue dans une base **sans partie** (base neuve) :

```bash
npm run restore -- backups/dossier-x-2026-10-21T10-00-00-000Z.json
```

Le script crée le schéma (migrations), vide le scénario de démonstration importé automatiquement, réinsère toutes les lignes dans une transaction et recale les séquences. Les joueurs conservent leurs identités : leurs jetons restent valides.

## Procédure testée

Le cycle suivant a été exécuté lors du développement : partie créée, un joueur, lancement, fouille (5 preuves) → `npm run backup` (159 lignes) → `npm run restore` dans une base vide → serveur démarré sur la base restaurée : la partie, ses 5 preuves et son journal sont présents et le jeton du joueur fonctionne.
