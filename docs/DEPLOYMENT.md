# Mise en ligne de CUTLY

## Architecture gratuite préparée

- Render Free héberge une seule application Node.js. La page publique et l'administration `/admin.html` sont servies par cette même application et cette même origine HTTPS. Les API d'administration restent protégées par connexion et MFA.
- PostgreSQL est externe au service Render. Le Blueprint attend une URL `CUTLY_DATABASE_URL`; aucune base payante ni base éphémère Render n'est créée. Neon propose un plan Free utilisable sans carte bancaire, soumis à ses limites de ressources.
- Resend envoie les e-mails de vérification et de récupération. Son compte, le domaine expéditeur et la clé secrète doivent être configurés séparément. Pas de SMS/Twilio au lancement.
- L'URL gratuite sera une adresse `https://...onrender.com`. Aucun domaine personnalisé n'est nécessaire.

Cette option permet une bêta publique gratuite, mais pas une exploitation commerciale robuste : le service Render Free s'endort après inactivité et son disque local est éphémère. Les garanties de disponibilité et de restauration de la base gratuite sont limitées. Render recommande de ne pas utiliser ses offres gratuites pour une application de production. Les sauvegardes réelles restent à concevoir et tester avant toute utilisation avec des clients.

Pour maintenir un plafond strict de 0 €, ne pas ajouter de moyen de paiement à Render : en cas de dépassement des quotas inclus, Render indique qu'il suspend les services au lieu de facturer. Contrôler l'usage régulièrement. Resend Free comprend 3 000 e-mails par mois et 100 par jour, mais l'envoi aux clients nécessite un domaine expéditeur que tu peux gérer dans son DNS. Si tu n'as pas déjà un domaine, son achat coûterait de l'argent ; sans cela, l'application peut être en ligne, mais l'inscription/réservation restera bloquée faute de vérification e-mail utilisable.

## Paramètres de déploiement

`render.yaml` prépare un service Render Free, sans auto-déploiement. Lors de la création du Blueprint, renseigner dans l'interface Render (jamais dans Git ni dans le chat) :

- `CUTLY_DATABASE_URL` : URL PostgreSQL Neon, avec SSL si requis par le fournisseur.
- `CUTLY_PUBLIC_BASE_URL` : URL `onrender.com` attribuée au service.
- `CUTLY_MFA_ENCRYPTION_KEY` : clé base64 persistante de 32 octets.
- `RESEND_API_KEY` et `CUTLY_EMAIL_FROM` : identifiants d'envoi vérifiés.
- `CUTLY_JOB_TOKEN` : secret aléatoire pour l'exécution protégée des rappels.

En local, la configuration Neon peut fournir `DATABASE_URL` dans `.env.local`. L'application
et les commandes `npm run migrate:sqlite-to-postgres`, `npm run backup:postgres` et
`npm run bootstrap:admin` chargent ce fichier et acceptent cette variable. La migration
SQLite vers PostgreSQL exige une cible PostgreSQL vide et crée d'abord une sauvegarde
SQLite vérifiée; elle ne doit être lancée qu'après inspection de la cible et vérification
du fichier de sauvegarde.

L'application exige PostgreSQL, Resend, HTTPS et une clé MFA pour démarrer en mode production. Le premier compte administrateur doit être initialisé de manière sécurisée une fois la base accessible. Ne pas partager les secrets par chat.

## Mise en ligne sans perte

1. Pousser le code validé sur le dépôt GitHub public déjà choisi.
2. Créer le projet PostgreSQL Neon et conserver ses identifiants dans un gestionnaire de secrets local.
3. Exporter la base locale vers une sauvegarde, vérifier qu'elle peut être relue, puis tester la migration sur une base PostgreSQL de préproduction vide. Comparer comptes, services, horaires, réservations, paiements et fidélité.
4. Créer le Web Service Render depuis le dépôt avec le Blueprint, en vérifiant l'écran de prix avant de valider. Confirmer que le plan sélectionné reste Free.
5. Renseigner les secrets sur Render, vérifier l'expéditeur chez Resend, puis déployer.
6. Initialiser le compte administrateur sans publier le secret TOTP. Vérifier `/healthz`, `/api/status`, inscription, e-mail réel, MFA, réservation et restauration de sauvegarde.
7. Partager l'adresse Render lorsque les vérifications sont terminées.

La préparation du Blueprint ne crée aucun compte, service, base ou déploiement. L'URL publique n'existe qu'après création et publication dans les comptes Render, Neon et Resend.
