# Sauvegarde et restauration CUTLY

## SQLite locale

La commande npm run backup -- <nouveau-fichier.sqlite> utilise VACUUM INTO, vérifie PRAGMA integrity_check et refuse d’écraser un fichier existant. Le dossier de destination doit exister et être protégé.

    npm run backup -- C:\chemin\backups\cutly-2026-10-13.sqlite

Le script ne chiffre pas, n’envoie pas la copie hors site et ne définit pas la rétention. Le test automatisé vérifie une base temporaire, pas un incident réel sur les données de CUTLY.

## PostgreSQL Render

La configuration préparée utilise PostgreSQL managé. Render propose une récupération à un instant antérieur sur ses plans PostgreSQL payants; la fenêtre dépend du plan d’espace. Les exports logiques déclenchés depuis la console sont conservés sept jours selon sa documentation. Cela ne remplace pas une politique de sauvegarde exportée, une rétention durable ni un test de restauration.

Avant lancement, définir le RPO/RTO, la rétention, l’emplacement de sauvegarde indépendant et le responsable de restauration. Tester la restauration sur une nouvelle instance isolée et vérifier les réservations, paiements, points, récompenses et journaux avant une bascule.

## Procédure de restauration sûre

1. Suspendre les écritures et conserver une copie de la base concernée.
2. Restaurer vers une nouvelle base ou un nouveau fichier; ne jamais écraser l’original.
3. Vérifier l’intégrité, les clés étrangères, les nombres de lignes et les écritures attendues.
4. Démarrer CUTLY dans un environnement isolé et vérifier /healthz ainsi que les parcours critiques.
5. Comparer le point de sauvegarde aux écritures qui ont suivi et décider explicitement de l’instant de reprise.
6. Basculer la configuration seulement après validation; documenter l’incident et surveiller l’application.

La restauration peut perdre les écritures postérieures au point choisi. Le retour de PostgreSQL vers SQLite n’est pas automatique; il exige une réconciliation des données créées après la migration.

Voir aussi docs/POSTGRESQL_MIGRATION.md et docs/DEPLOYMENT.md.
