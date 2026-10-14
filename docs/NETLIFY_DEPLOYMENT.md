# Archive historique — Netlify (non utilisé)

Cette procédure est obsolète. La cible d’hébergement choisie est Render ; consulter [docs/DEPLOYMENT.md](DEPLOYMENT.md). Les choix actuels de vérification e-mail uniquement et numéro de téléphone comme contact remplacent les anciens passages ci-dessous.

État vérifié le 13 octobre 2026. Le compte Netlify a été ouvert, mais aucun site CUTLY, base PostgreSQL, URL publique ni fournisseur de notifications n’a été connecté. Le site RIHLA existant dans le compte n’est pas CUTLY et ne doit pas être modifié.

## Configuration du dépôt

- `netlify.toml` publie les fichiers statiques de `public/`, exécute `npm run check && npm test`, et redirige `/api/*` ainsi que `/healthz` vers la fonction `netlify/functions/api.js`. Le schéma `db/postgres/schema.sql` est déclaré comme fichier à inclure dans l’artefact serverless car la fonction le lit lors de l’initialisation PostgreSQL.
- La fonction encapsule le serveur HTTP existant. Elle attend l’initialisation de la base puis tente de traiter un petit lot de notifications après la réponse HTTP. Une erreur d’envoi ne change pas le résultat déjà enregistré d’une réservation.
- PostgreSQL peut être fourni avec `NETLIFY_DB_URL` ; `CUTLY_DATABASE_URL` reste pris en charge pour les outils de migration et environnements existants. Le pool PostgreSQL utilise deux connexions par instance Netlify par défaut afin de limiter la multiplication des connexions ; `CUTLY_DB_POOL_MAX` peut le régler de 1 à 20 si la capacité de la base a été vérifiée.
- Le schéma PostgreSQL est initialisé au démarrage avec verrou consultatif et transaction afin de gérer les démarrages à froid concurrents.

La fonction Netlify et les routes de santé ont été testées localement. Aucun test n’a été exécuté dans un compte ou une infrastructure Netlify réelle.

## Limites importantes du plan gratuit

Le plan Netlify Free est affiché à 0 USD/mois avec 300 crédits mensuels et un plafond strict. Un déploiement de production consomme 15 crédits. La base consomme des crédits de calcul et de bande passante ; elle est plafonnée à 48 unités de calcul, 5 Go de données écrites, 5 Go de bande passante et 5 Go de stockage par période. Elle s’endort après 5 minutes d’inactivité, avec 3 jours de rétention des sauvegardes planifiées. La documentation consultée ne donne pas le tarif du stockage après le 1er juillet 2026 : vérifier les conditions affichées dans le compte avant de créer la base. Aucun rechargement n’est possible sur le plan Free ; atteindre une limite peut interrompre les ressources.

Les fonctions planifiées existent sur tous les plans, mais un réveil fréquent de PostgreSQL pour livrer les rappels de 24 h et 2 h consomme du calcul. Un rythme suffisamment fréquent peut dépasser le budget gratuit de la base, et un rythme espacé ferait arriver les rappels en retard. Le plan Free n’est donc pas validé comme exploitation fiable de CUTLY sans mesure d’usage et stratégie de tâches adaptée. Les rappels ne sont pas déclarés opérationnels.

Sources officielles : [plans et crédits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [consommation et limites PostgreSQL](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/), [fonctions planifiées](https://docs.netlify.com/build/functions/scheduled-functions/), [Express sur Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/).

Pour la comparaison avec Neon Free et Supabase Free, les plafonds de calcul, stockage, suspension et sauvegardes sont consignés dans [PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md). Aucune offre gratuite n’est considérée comme validée pour la production commerciale.

## Éléments à préparer dans Netlify

1. Connecter le compte Netlify au dépôt GitHub public `noctivl9-rgb/cutly` et vérifier la branche `main` et la commande de build. Ne pas activer de publication avant l’autorisation de lancement public.
2. Examiner les conditions de facturation affichées avant de créer une base. Désactiver toute recharge payante automatique et confirmer que les fonctionnalités arrêtées à la limite stricte sont acceptables.
3. Créer la base PostgreSQL Netlify, puis renseigner la chaîne en variable sécurisée `NETLIFY_DB_URL` dans la configuration du site. Vérifier les tarifs de stockage actuels dans la console.
4. Ajouter `CUTLY_PUBLIC_BASE_URL` avec l’URL HTTPS Netlify attribuée, `CUTLY_MFA_ENCRYPTION_KEY`, `RESEND_API_KEY`, `CUTLY_EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et `TWILIO_FROM` ou `TWILIO_MESSAGING_SERVICE_SID`. Les secrets sont à saisir directement dans le gestionnaire Netlify, jamais dans Git ou dans le chat.
5. La mise en production exige des fournisseurs Resend et Twilio configurés et validés. Le serveur refuse le mode production lorsque les paramètres obligatoires sont absents ; la réservation reste bloquée tant que l’e-mail, le SMS, HTTPS et MFA ne sont pas prêts.
6. Avant migration, faire une copie SQLite distincte et vérifier son intégrité. Migrer vers une base PostgreSQL vide, comparer les comptes de lignes et contrôler les relations avant toute ouverture des écritures clientes. Ne pas supprimer ni réinitialiser la base locale.
7. Initialiser le compte administrateur final avec MFA via la procédure documentée, puis exécuter les essais sur l’URL de prévisualisation avant d’autoriser séparément le lancement public.

## Variables et migrations

La commande `npm run migrate:sqlite-to-postgres` accepte `CUTLY_DATABASE_URL` ou `NETLIFY_DB_URL`. Le bootstrap du premier administrateur accepte ces mêmes variables. Ne jamais afficher la chaîne de connexion. Une cible contenant déjà des tables est refusée. La migration crée et vérifie une nouvelle sauvegarde avant d’écrire la base cible.

Ne jamais importer des données réelles dans un environnement de test partagé. Ne pas revenir à SQLite après avoir commencé à écrire de nouvelles réservations, paiements ou mouvements de fidélité dans PostgreSQL.

## État de lancement

La préparation du code n’équivaut pas à un déploiement. À ce jour, l’URL locale `127.0.0.1:3000` reste privée à l’environnement de développement ; aucun lien public CUTLY ne peut être fourni. Le domaine personnalisé est à choisir plus tard. Les comptes Resend/Twilio, l’analyse juridique RGPD, la restauration PostgreSQL et les rappels fiables restent à traiter.
