# CUTLY

Plateforme de réservation pour Thomas Shop. Le projet utilise Node.js 24, SQLite en développement local et PostgreSQL en hébergement. Netlify est la cible d’hébergement préparée avec PostgreSQL Neon ; le projet Netlify existe, mais il reste privé et le backend de production n’est pas configuré.

## Démarrage local

```powershell
npm start
```

Ouvrir <http://127.0.0.1:3000>. Cette adresse est locale. La base SQLite se trouve dans `data/cutly.sqlite`.

## Vérifications locales

```powershell
npm run check
npm test
npm audit --omit=dev
```

Les tests utilisent SQLite temporaire. Ils ne remplacent pas une validation PostgreSQL réelle, l’essai d’e-mails réels ni les vérifications de production.

## Compte administrateur

`npm run bootstrap:admin` initialise le premier compte après le démarrage et l’initialisation de la base. Il exige un e-mail valide, un mot de passe robuste et `CUTLY_MFA_ENCRYPTION_KEY`. Le secret TOTP est affiché une seule fois. Ne pas utiliser des identifiants locaux en production.

## Réservations, paiements et fidélité

Le client vérifie son e-mail et fournit un numéro de téléphone de contact avant de réserver. Aucun SMS ni code téléphonique n’est requis. Tant que Resend n’est pas configuré, les e-mails réels ne partent pas et la réservation reste bloquée. Les paiements sont sur place. Les avis attendent l’approbation de Thomas. Une récompense réservée est restituée après un `NO_SHOW` et consommée uniquement lorsque la prestation est marquée `COMPLETED`.

Le brouillon de confidentialité et les parcours d’export/demande ne constituent pas une validation juridique RGPD. Les durées de conservation, les sous-traitants et les règles de suppression/anonymisation restent à valider.

## Installation mobile

La PWA utilise un cache limité à la page hors connexion, à la page d’installation et aux icônes. Les routes API, les données privées et les réservations ne sont jamais mises en cache. En production HTTPS, consulter `/install.html` pour les instructions iPhone et Android. Les navigateurs et appareils physiques doivent encore être testés avant de déclarer l’installation vérifiée.

## Installation mobile

La PWA utilise un cache limité à la page hors connexion, à la page d’installation et aux icônes. Les routes API, les données privées et les réservations ne sont jamais mises en cache. En production HTTPS, consulter `/install.html` pour les instructions iPhone et Android. Les navigateurs et appareils physiques doivent encore être testés avant de déclarer l’installation vérifiée.

## Dépôt et hébergement

Le dépôt public est [noctivl9-rgb/cutly](https://github.com/noctivl9-rgb/cutly), branche `main`. Netlify sert les pages et les fonctions serverless ; Neon fournit PostgreSQL. Consultez [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) pour les prérequis et les étapes. Le site client et `/admin.html` partagent la même origine.

Une ancienne configuration Render est conservée dans le dépôt, mais Netlify est la cible active. La migration SQLite vers PostgreSQL doit être précédée d’une sauvegarde vérifiée ; voir [docs/POSTGRESQL_MIGRATION.md](docs/POSTGRESQL_MIGRATION.md).

L’état de préparation, les limitations et les étapes encore nécessaires figurent dans [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). Voir aussi [docs/PROVIDERS.md](docs/PROVIDERS.md) et [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md).
