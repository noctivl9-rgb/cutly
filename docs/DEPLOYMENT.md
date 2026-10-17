# Mise en ligne de CUTLY

## Architecture cible

- Netlify sert les pages de `public/` et les fonctions Node de `netlify/functions/` sur la même origine HTTPS. La page client, la PWA et `/admin.html` partagent cette origine.
- Neon fournit le PostgreSQL persistant. L’application Netlify doit recevoir l’URL PostgreSQL dans `CUTLY_DATABASE_URL`; aucune base SQLite ne doit être utilisée par les fonctions serverless.
- Resend envoie les liens de vérification et de récupération. Il faut une clé valide et une adresse expéditrice associée à un domaine vérifié. Aucun SMS n’est requis : le téléphone est une coordonnée de contact.
- Le sous-domaine Netlify `https://cutly-thomas-shop.netlify.app` est l’adresse publique prévue. Aucun domaine personnalisé n’est nécessaire.

Le site Netlify existe mais son accès est encore privé. Au dernier contrôle, `/api/status` échouait dans la fonction et le projet n’avait aucune variable d’environnement configurée. La page ne doit pas être annoncée comme prête aux réservations tant que la base, l’e-mail et l’administrateur ne sont pas configurés et vérifiés.

## Configuration Netlify

Le dépôt contient `netlify.toml`, qui publie `public/`, construit avec `npm run check && npm test` et redirige `/api/*` vers la fonction Netlify. `.node-version` fixe Node 24.20.0 pour le build. Le paramètre Netlify `AWS_LAMBDA_JS_RUNTIME=nodejs24.x` est également configuré pour les fonctions.

Variables à définir dans l’environnement Netlify, sans les ajouter au dépôt ni les partager dans le chat :

- `CUTLY_DATABASE_URL` : URL PostgreSQL Neon, idéalement l’URL poolée pour le trafic de l’application.
- `CUTLY_PUBLIC_BASE_URL` : `https://cutly-thomas-shop.netlify.app`.
- `CUTLY_MFA_ENCRYPTION_KEY` : clé persistante, base64, de 32 octets.
- `RESEND_API_KEY` et `CUTLY_EMAIL_FROM` : clé et expéditeur liés à un domaine vérifié.
- `CUTLY_JOB_TOKEN` : secret aléatoire d’au moins 32 octets si le déclenchement protégé des rappels est utilisé.
- `CUTLY_BOOTSTRAP_ADMIN_EMAIL` et `CUTLY_BOOTSTRAP_ADMIN_PASSWORD` : valeurs temporaires à utiliser uniquement lors de l’initialisation sécurisée du premier administrateur, puis à retirer.

Le runtime Netlify, l’URL publique et l’adresse de base sont configurés. La base, les clés de production, l’expéditeur d’e-mail et le compte administrateur ne le sont pas encore. L’ajout d’une variable d’environnement nécessite une nouvelle publication pour être pris en compte.

## Données et migration

En local, SQLite se trouve dans `data/cutly.sqlite`. La production utilise PostgreSQL. Avant toute migration :

1. Créer et vérifier une sauvegarde SQLite lisible.
2. Préparer une branche ou base de test PostgreSQL distincte.
3. Exécuter la migration sur cette cible de test.
4. Comparer les comptes, services, horaires, rendez-vous, paiements et mouvements de fidélité.
5. Ne migrer la production qu’après validation de la sauvegarde, de la restauration et des données.

Ne pas réinitialiser la base locale ou de production pour faciliter le déploiement.

## Lancement

1. Authentifier Netlify CLI avec le compte qui possède `cutly-thomas-shop`.
2. Connecter le projet Neon et vérifier la cible PostgreSQL avant toute migration.
3. Ajouter les variables de production dans Netlify, avec les secrets marqués comme secrets.
4. Vérifier le domaine expéditeur et l’envoi réel d’un e-mail de vérification avec Resend.
5. Publier une version de prévisualisation et vérifier `/healthz`, `/api/status`, le parcours client, la réservation concurrente et l’administration MFA.
6. Initialiser le compte de Thomas de manière sécurisée. Ne pas partager son mot de passe ni son secret TOTP dans le chat.
7. Vérifier une sauvegarde et sa restauration avant de rendre le site public.
8. Rendre le projet Netlify public puis communiquer le lien lorsque les contrôles passent.

Aucun achat ni abonnement n’est nécessaire pour préparer le code. Les limites et tarifs des services externes doivent être vérifiés dans leurs tableaux de bord avant toute utilisation réelle. Ne jamais affirmer que l’application est prête en production sur la seule base d’un build réussi.