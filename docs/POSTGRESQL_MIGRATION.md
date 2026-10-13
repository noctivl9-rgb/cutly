# Migration contrôlée SQLite vers PostgreSQL

## Ce que fait le script

`npm run migrate:sqlite-to-postgres` crée d’abord une copie SQLite distincte via `VACUUM INTO`, vérifie son intégrité et ses clés étrangères, détecte les chevauchements de rendez-vous actifs, puis importe les lignes dans une transaction PostgreSQL. La cible doit être vide ; le script compare ensuite les nombres de lignes. La source SQLite reste intacte.

Cette procédure n’a pas été exécutée sur les données CUTLY ni sur une base PostgreSQL réelle.

## Avant de migrer

- Arrêter le serveur et tout processus susceptible d’écrire dans le fichier SQLite.
- Vérifier le chemin source, le dossier de sauvegarde et l’espace disque.
- Créer une base PostgreSQL neuve et vide ; ne pas démarrer CUTLY dessus avant la migration.
- Définir `CUTLY_DATABASE_URL` ou `NETLIFY_DB_URL` dans l’environnement du processus, sans inscrire l’URL dans le dépôt, les logs ou le chat.
- Utiliser TLS et les règles de connexion réseau recommandées par le fournisseur. Ne pas désactiver TLS ni laisser une règle réseau temporaire ouverte.
- Vérifier les données et comptes contenus dans SQLite avant leur transfert vers une base accessible en production.

## Commande PowerShell

Après avoir renseigné l’URL de PostgreSQL dans l’environnement protégé :

```powershell
npm run migrate:sqlite-to-postgres -- --sqlite C:\chemin\cutly.sqlite --backup C:\chemin\backups\cutly-pre-postgres.sqlite
```

La destination de sauvegarde doit être un nouveau fichier et ne peut pas être écrasée.

## Vérifier avant bascule

1. Conserver la sortie JSON du script et les nombres de lignes par table.
2. Vérifier comptes, établissements, horaires, services, réservations, statuts, paiements, récompenses, avis et journaux.
3. Exécuter les contrôles applicatifs contre cette vraie base PostgreSQL. Les tests SQLite ne valident pas les requêtes et contraintes d’un moteur PostgreSQL.
4. Confirmer que les sessions et le MFA sont récupérables avec la même clé de chiffrement ; ne pas réinitialiser l’administrateur.
5. Démarrer une instance de validation et contrôler les parcours avant l’ouverture des écritures clientes.
6. Garder la source SQLite et sa sauvegarde protégées, en lecture seule, durant la période de vérification.

En cas d’échec, conserver source, sauvegarde et erreur. Ne pas relancer dans une cible qui peut contenir des données utiles.

## Limites

Le test automatisé couvre la création/vérification de sauvegarde temporaire, mais aucun PostgreSQL n’a été disponible pour tester la migration complète, la syntaxe, les performances et les requêtes réelles. Une migration du fichier CUTLY demeure à faire avec une cible et un accès sécurisés.

La procédure ne supprime pas la source. Toute suppression, anonymisation ou archivage relève d’une décision distincte après validation des durées de conservation et obligations légales.
