# CUTLY

Plateforme de réservation pour Thomas Shop. Le projet utilise Node.js 24, SQLite en développement local et PostgreSQL en hébergement. Netlify est la cible d’hébergement choisie ; le site n’est pas encore déployé publiquement.

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

Les tests utilisent SQLite temporaire. Ils ne remplacent pas une validation PostgreSQL réelle, les essais de vrais e-mails/SMS ni les vérifications de production.

## Compte administrateur

`npm run bootstrap:admin` initialise le premier compte après le démarrage et l’initialisation de la base. Il exige un e-mail valide, un mot de passe robuste et `CUTLY_MFA_ENCRYPTION_KEY`. Le secret TOTP est affiché une seule fois. Ne pas utiliser des identifiants locaux en production.

## Réservations, paiements et fidélité

La double vérification e-mail/téléphone est obligatoire avant toute réservation. Sans configuration réelle de Resend et Twilio, les envois ne sont pas simulés et la réservation reste bloquée. Les paiements sont sur place. Les avis attendent l’approbation de Thomas. Une récompense réservée est restituée après un `NO_SHOW` et consommée uniquement lorsque la prestation est marquée `COMPLETED`.

Le brouillon de confidentialité et les parcours d’export/demande ne constituent pas une validation juridique RGPD. Les durées de conservation, les sous-traitants et les règles de suppression/anonymisation restent à valider.

## Dépôt et hébergement

Le dépôt public est [noctivl9-rgb/cutly](https://github.com/noctivl9-rgb/cutly), branche `main`. Netlify est l’hébergeur demandé. La configuration du site et de la fonction se trouve dans `netlify.toml` et `netlify/functions/api.js`. Le guide est dans [docs/NETLIFY_DEPLOYMENT.md](docs/NETLIFY_DEPLOYMENT.md).

Le fichier `render.yaml` est conservé comme ancien travail de préparation et n’est pas la cible retenue. La migration SQLite vers PostgreSQL doit être précédée d’une sauvegarde vérifiée ; voir [docs/POSTGRESQL_MIGRATION.md](docs/POSTGRESQL_MIGRATION.md).

L’état de préparation, les limitations et les étapes encore nécessaires figurent dans [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). Voir aussi [docs/PROVIDERS.md](docs/PROVIDERS.md) et [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md).
