# CUTLY

Plateforme de réservation pour Thomas Shop. Le projet utilise Node.js 24, SQLite natif en développement local et PostgreSQL en production. Le site n’est pas encore déployé publiquement.

## Démarrage local

    npm start

Ouvrir http://127.0.0.1:3000. Cette adresse n’est accessible que depuis l’environnement local. La base locale se trouve dans `data/cutly.sqlite`.

## Vérifications

    npm run check
    npm test

Les tests utilisent SQLite temporaire. Ils ne remplacent pas les essais sur PostgreSQL réel, l’envoi de véritables e-mails/SMS ni les vérifications en production.

## Compte administrateur

`npm run bootstrap:admin` initialise le premier compte après le démarrage et l’initialisation de la base. La procédure exige un e-mail valide, un mot de passe robuste et `CUTLY_MFA_ENCRYPTION_KEY`; le secret TOTP est affiché une seule fois. Ne pas utiliser les identifiants locaux en production.

## Réservations, paiements et fidélité

La double vérification e-mail/téléphone est obligatoire avant réservation. Sans configuration réelle de Resend et Twilio, les envois ne sont pas simulés et la réservation reste bloquée. Les paiements sont enregistrés sur place. Les avis attendent l’approbation de Thomas. Une récompense réservée est restaurée après un `NO_SHOW` et consommée seulement quand la prestation est marquée `COMPLETED`.

Le brouillon de confidentialité et les parcours d’export/demande ne valent pas validation juridique RGPD. Les durées de conservation, les sous-traitants et la politique de suppression/anonymisation restent à valider.

## Dépôt et déploiement

Le dépôt public est [noctivl9-rgb/cutly](https://github.com/noctivl9-rgb/cutly). La branche `main` contient le code de préparation. Le Blueprint Render se trouve dans `render.yaml`; il prévoit un web service et une base PostgreSQL avec des plans payants. Ne pas synchroniser le Blueprint sans décision explicite sur le coût et le lancement.

La migration contrôlée SQLite vers PostgreSQL est décrite dans [docs/POSTGRESQL_MIGRATION.md](docs/POSTGRESQL_MIGRATION.md). Le plan et les prérequis de production sont dans [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/PROVIDERS.md](docs/PROVIDERS.md) et [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md).
