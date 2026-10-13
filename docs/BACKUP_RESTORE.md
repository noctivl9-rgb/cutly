# Sauvegarde et restauration CUTLY

## SQLite locale

`npm run backup -- <nouveau-fichier.sqlite>` utilise `VACUUM INTO`, vérifie `PRAGMA integrity_check` et refuse d’écraser une destination existante.

```powershell
npm run backup -- C:\chemin\backups\cutly-2026-10-13.sqlite
```

Le script ne chiffre pas, n’envoie pas la copie hors site et ne définit pas une rétention. Le test automatisé utilise une base temporaire, pas les données réelles de CUTLY.

## PostgreSQL Netlify

Netlify Database fournit des sauvegardes planifiées avec une rétention de 3 jours et conserve la base du dernier déploiement publié sur le plan Free, selon la documentation consultée le 13 octobre 2026. Ce mécanisme ne remplace pas une copie indépendante ni un essai de restauration. Les limites et crédits sont documentés dans [NETLIFY_DEPLOYMENT.md](NETLIFY_DEPLOYMENT.md) ; vérifier les paramètres réels du compte avant d’y placer des données.

Avant lancement, définir le RPO/RTO, la rétention, une sauvegarde indépendante et un responsable de restauration. Tester la restauration sur une nouvelle base isolée et vérifier réservations, paiements, points, récompenses et journaux avant la bascule.

## Restauration sûre

1. Suspendre les écritures et conserver une copie de la base concernée.
2. Restaurer vers une nouvelle base ou un nouveau fichier ; ne pas écraser l’original.
3. Vérifier l’intégrité, les clés étrangères, les nombres de lignes et les écritures attendues.
4. Démarrer CUTLY dans un environnement isolé et vérifier `/healthz` ainsi que les parcours critiques.
5. Comparer le point de sauvegarde aux écritures qui ont suivi et choisir explicitement le point de reprise.
6. Basculer la configuration après validation, documenter l’incident et surveiller l’application.

La restauration peut perdre les écritures postérieures au point choisi. Le retour de PostgreSQL vers SQLite n’est pas automatique et exige de réconcilier les données créées depuis la migration.

Voir aussi [POSTGRESQL_MIGRATION.md](POSTGRESQL_MIGRATION.md) et [NETLIFY_DEPLOYMENT.md](NETLIFY_DEPLOYMENT.md).
