# CUTLY

Plateforme de réservation pour Thomas Shop. Le projet utilise Node.js 24, SQLite natif pour le développement local et un adaptateur PostgreSQL préparé pour Render. La base SQLite locale est conservée; aucun service externe n’est configuré par défaut.

## Démarrage local

    npm start

Ouvrir http://127.0.0.1:3000. Le serveur local utilise data/cutly.sqlite. Ce lien ne donne pas accès au site depuis Internet.

## Vérifications

    npm run check
    npm test

Les tests utilisent des bases temporaires SQLite. Ils couvrent les règles de réservation, la vérification client, les autorisations admin et MFA, les annulations, les paiements et leurs corrections, la fidélité, les récompenses, les avis et la sérialisation de réservations concurrentes dans l’adaptateur SQLite. Ils ne remplacent pas des tests PostgreSQL réels.

## Compte administrateur

Le script npm run bootstrap:admin initialise le premier compte admin après démarrage et initialisation de la base. Il exige une adresse e-mail valide, un mot de passe robuste et CUTLY_MFA_ENCRYPTION_KEY. Il affiche le secret TOTP une seule fois. Ne jamais utiliser les identifiants de démonstration en production.

## Données et fonctionnalités

Le site client applique la double vérification e-mail/téléphone avant la réservation. Les fournisseurs Resend et Twilio sont requis pour ces parcours; en leur absence, les envois ne sont pas simulés et la réservation reste bloquée. Le paiement est enregistré sur place. Les avis attendent l’approbation de Thomas avant publication. Les récompenses sont rendues disponibles si une réservation offerte se termine en NO_SHOW.

Le brouillon de confidentialité et les parcours d’export/demande ne constituent pas une validation juridique RGPD. Les durées de conservation et le processus d’anonymisation ou suppression doivent encore être validés.

## PostgreSQL et Render

Le dépôt GitHub public `noctivl9-rgb/cutly` est préparé pour recevoir le code. Le Blueprint Render prépare un service web et une base PostgreSQL, mais il n’a pas été synchronisé et crée des ressources payantes. Aucun domaine n’a été choisi.

La migration contrôlée est documentée dans docs/POSTGRESQL_MIGRATION.md. Elle n’a pas été exécutée sur la base locale. Le schéma, l’adaptateur et les requêtes PostgreSQL doivent encore être vérifiés sur une instance PostgreSQL réelle avant le lancement.

Resend et Twilio ne sont pas configurés. Aucun achat, abonnement, connexion de compte ou déploiement public n’a été effectué.

Voir [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md), [déploiement Render](docs/DEPLOYMENT.md), [migration PostgreSQL](docs/POSTGRESQL_MIGRATION.md), [fournisseurs](docs/PROVIDERS.md) et [sauvegarde/restauration](docs/BACKUP_RESTORE.md).
