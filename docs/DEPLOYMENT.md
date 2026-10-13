# Déploiement

La cible choisie est Netlify. Suivre [NETLIFY_DEPLOYMENT.md](NETLIFY_DEPLOYMENT.md) pour le statut actuel, les variables et les limites du plan gratuit. `netlify.toml` décrit le build et les redirections vers la fonction serverless. Aucun site Netlify ni déploiement n’a été créé.

Le fichier `render.yaml` et les mentions Render dans des documents d’architecture/migration sont des restes de la préparation précédente ; ils ne sont pas la configuration active choisie. Ne pas synchroniser ce Blueprint.

La mise en ligne dépend toujours de l’accès au compte Netlify, d’une décision éclairée sur les quotas de base, de la configuration PostgreSQL, des variables Resend/Twilio et de la validation des données. La migration SQLite/PostgreSQL est décrite dans [POSTGRESQL_MIGRATION.md](POSTGRESQL_MIGRATION.md). Ne jamais lancer une migration sur une base cible non vide, ni avant une sauvegarde vérifiée.

Les tests locaux ne prouvent pas l’exécution en production. Publier seulement après les essais de prévisualisation, les vérifications des fournisseurs et l’autorisation de mise en ligne.
