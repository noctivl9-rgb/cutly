# CUTLY — préparation de mise en ligne

Mis à jour le 14 octobre 2026. La cible est une bêta gratuite Render + PostgreSQL externe. Le site n'est pas encore public.

## Politique validée

- Vérification e-mail obligatoire avant réservation.
- Téléphone obligatoire comme coordonnée de contact, sans vérification SMS.
- Aucun fournisseur SMS/Twilio nécessaire au lancement.
- Paiement sur place, avis soumis à Thomas, MFA obligatoire pour l'administration.

## Préparé dans le code

- Un service Render Free partagé par la page client et l'administration.
- URL PostgreSQL externe attendue via `CUTLY_DATABASE_URL`; aucun Render Postgres payant/éphémère dans le Blueprint.
- Resend utilisé pour les e-mails transactionnels; configuration nécessaire avant activation des inscriptions.
- Tests et vérifications de code disponibles via `npm run check` et `npm test`.

## Bloqueurs pour rendre l'adresse publique utilisable

- Le code courant doit être envoyé sur la branche GitHub connectée au service Render.
- Il faut créer/configurer les comptes Render, Neon et Resend. Aucun compte ni service n'a été créé depuis cet environnement.
- Secrets nécessaires : URL PostgreSQL, URL publique Render, clé MFA persistante, clé Resend, expéditeur autorisé, jeton du planificateur de rappels. Les saisir uniquement dans les consoles correspondantes.
- Migrer la base locale après sauvegarde vérifiée et essai de restauration, puis initialiser l'administrateur sur PostgreSQL.
- Déployer, vérifier les e-mails réellement reçus, `/healthz`, `/api/status`, MFA et le parcours client avant de partager l'URL.

## Limites du mode gratuit

Render Free endort le serveur après inactivité et son stockage local est éphémère. Neon Free a des limites et n'offre pas les garanties d'une base de production. La configuration peut servir une bêta publique sans frais de plateforme, mais ne doit pas être présentée comme une disponibilité commerciale fiable. La conservation RGPD, les sauvegardes indépendantes et la restauration nécessitent encore validation.

La procédure détaillée est dans [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Aucune publication ou dépense n'a été réalisée.
