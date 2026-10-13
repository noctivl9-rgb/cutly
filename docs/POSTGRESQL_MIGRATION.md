# Migration contrôlée SQLite vers PostgreSQL

## Ce que fait le script

La commande npm run migrate:sqlite-to-postgres crée d’abord une copie SQLite distincte avec VACUUM INTO, vérifie son intégrité et ses clés étrangères, contrôle les chevauchements de rendez-vous actifs, puis importe les lignes dans une transaction PostgreSQL. Elle exige que le schéma public PostgreSQL soit vide et compare les nombres de lignes avant de valider. Les réservations historiques, paiements, récompenses et journaux restent sur la source jusqu’à ce qu’un responsable décide de la suite.

Le script n’a pas été exécuté sur la base CUTLY existante. Aucune sauvegarde ou modification de cette base n’a été faite pendant la préparation.

## Prérequis avant l’exécution

- Arrêter CUTLY et tous les processus susceptibles d’écrire dans le fichier SQLite.
- Vérifier le chemin du fichier source, le dossier de sauvegarde et l’espace disque disponible.
- Utiliser une base PostgreSQL neuve et vide, sans démarrer l’application contre elle au préalable.
- Renseigner CUTLY_DATABASE_URL uniquement dans l’environnement du processus, jamais dans un fichier suivi par Git ni dans un chat.
- Si la commande tourne hors de Render, utiliser l’URL externe avec TLS requis et limiter temporairement l’accès réseau à l’IP du poste dans la console Render. Le Blueprint interdit les connexions externes par défaut. Rétablir ensuite cette restriction.
- L’URL externe Render doit exiger TLS; elle comporte généralement le paramètre sslmode=require. Ne pas désactiver TLS.
- Valider les données et comptes présents dans SQLite avant de les transférer vers une base accessible en production.

Render fournit l’URL interne aux services du même espace et de la même région. Une commande exécutée sur un poste extérieur doit utiliser l’URL externe, qui exige TLS. Voir la documentation Render sur les chaînes de connexion.

## Commande

Dans PowerShell, après avoir configuré CUTLY_DATABASE_URL dans la session de façon protégée :

    npm run migrate:sqlite-to-postgres -- --sqlite C:\chemin\cutly.sqlite --backup C:\chemin\backups\cutly-pre-postgres.sqlite

La destination de sauvegarde doit être un nouveau fichier. Le script refuse de l’écraser. Pour les chemins réels, choisir un emplacement protégé et différent du dépôt.

## Vérifications et bascule

1. Conserver la sortie JSON de succès et les nombres de lignes par table.
2. Vérifier les comptes, établissements, horaires, services, réservations, statuts, historiques de paiement, récompenses, avis, sessions et journaux selon les nombres annoncés.
3. Lancer les contrôles applicatifs dans un environnement de validation contre la base PostgreSQL migrée; les tests SQLite seuls ne valident pas le comportement réel du serveur PostgreSQL.
4. Confirmer que les sessions et le MFA existants sont récupérables avec le même secret MFA; ne pas lancer de bootstrap administrateur qui créerait un autre compte.
5. Après validation, configurer l’application pour utiliser l’URL interne PostgreSQL Render et démarrer une seule instance de contrôle.
6. Garder la source SQLite et sa sauvegarde en lecture seule et protégées pendant la période de vérification décidée par le responsable.

Le script s’arrête sans valider la transaction si une table, une contrainte, un conflit ou un comptage ne correspond pas. En cas d’échec, conserver la source SQLite, la sauvegarde et la sortie d’erreur; ne pas recommencer sur la même base PostgreSQL partiellement utilisée. Examiner son état et recréer une cible vide seulement après avoir confirmé qu’elle ne contient aucune donnée utile.

## Limites actuelles

La migration a un test de sauvegarde automatisé sur une base temporaire, mais aucun moteur PostgreSQL n’est installé dans cet environnement. La syntaxe PostgreSQL, la migration complète, les performances, les contraintes et les requêtes du serveur n’ont donc pas été vérifiées sur une instance PostgreSQL réelle. La migration de la base CUTLY réelle reste en attente d’une cible PostgreSQL, d’un accès sécurisé et d’une vérification préalable des données à transférer.

La procédure ne supprime pas la source. Toute suppression, anonymisation ou archivage final reste une décision distincte, après validation de conservation et des obligations légales.
