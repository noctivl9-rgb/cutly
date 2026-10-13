# Préparation du déploiement Render

## État au 13 octobre 2026

`render.yaml` décrit un web service Node à Francfort et une base PostgreSQL managée distincte. Le service référence la connexion privée de la base et désactive le déploiement automatique. Le Blueprint n’a pas été synchronisé : aucun service Render, aucune base de production et aucun déploiement n’existent.

Le dépôt GitHub public `noctivl9-rgb/cutly` contient le code sur `main`. Le domaine reste à choisir. Le code local utilise toujours SQLite; la réservation est bloquée tant que Resend, Twilio et l’URL HTTPS ne sont pas configurés.

## Coût et niveau gratuit

Les plans configurés sont payants. Au 13 octobre 2026, le tarif officiel listé est d’environ 7 USD/mois pour le web `0.5c-512mb`, 19 USD/mois pour PostgreSQL `0.5c-1g` et 0,30 USD/GB/mois de stockage au-delà du premier GB inclus. Le disque de 5 GB du Blueprint donne environ 1,20 USD/mois de stockage supplémentaire, soit **environ 27,20 USD/mois**, hors taxes, trafic et services externes. Vérifier le récapitulatif de facturation Render avant toute création; aucun frais n’a été engagé.

Render propose un niveau gratuit, mais PostgreSQL gratuit expire au bout de 30 jours, puis est supprimé après une période de grâce de 14 jours et n’offre pas de sauvegardes. Un service web gratuit s’endort après 15 minutes d’inactivité; son système de fichiers est éphémère. Ce niveau convient au mieux à un aperçu temporaire sans données réelles, pas à une exploitation fiable de CUTLY.

Références officielles : [tarifs Render](https://render.com/pricing), [plans compute](https://render.com/docs/compute-plans), [limitations gratuites](https://render.com/docs/free), [spécification Blueprint](https://render.com/docs/blueprint-spec).

## Prérequis à réunir avant création

- Autorisation explicite pour créer les ressources payantes ou choix d’un environnement gratuit temporaire sans données réelles.
- Compte Render connecté au dépôt GitHub.
- Décision sur le domaine et accès DNS si un domaine personnalisé est souhaité.
- Comptes Resend/Twilio, expéditeur vérifié et secrets à configurer séparément.
- Adresse e-mail de production de Thomas et secret MFA de 32 octets stocké dans le gestionnaire de secrets.
- Validation juridique des textes, durées de conservation et sous-traitants.
- Décision documentée sur le transfert de la base SQLite locale.

Ne jamais envoyer de secret dans le chat, dans le dépôt, dans les logs ou dans une capture d’écran.

## Ordre de déploiement à suivre après autorisation

1. Dans Render, connecter le dépôt `noctivl9-rgb/cutly` et choisir le Blueprint `render.yaml`.
2. Examiner les ressources, région, stockage et montant affiché avant de confirmer. Ne pas continuer si le prix ne correspond pas à l’autorisation accordée.
3. Créer PostgreSQL sans démarrer l’application contre la base avant d’avoir décidé du transfert. Le Blueprint bloque les connexions externes; l’application de la même région utilise le réseau privé.
4. Si les données locales doivent être migrées, arrêter les écritures, faire une sauvegarde SQLite distincte et vérifier son intégrité. Suivre `POSTGRESQL_MIGRATION.md`; utiliser l’URL externe uniquement avec TLS et accès temporaire restreint. Ne jamais exécuter une migration sur une base contenant déjà des données utiles.
5. Après comparaison des données et de l’intégrité, configurer les secrets Render, l’URL HTTPS, Resend et Twilio.
6. Déployer d’abord dans un environnement de contrôle, puis vérifier `/healthz`, `/api/status`, les flux d’authentification, de réservation, de notification et d’administration.
7. Initialiser une seule fois l’administrateur final avec MFA. Ne pas recréer un compte si une migration a déjà transféré celui de Thomas.
8. Valider restauration, surveillance, documents RGPD et checklist avant ouverture publique.

## Variables de production

Le Blueprint injecte `CUTLY_DATABASE_URL` via l’URL privée PostgreSQL Render. Les autres secrets et paramètres `sync: false` sont renseignés dans le gestionnaire Render : `CUTLY_PUBLIC_BASE_URL`, `CUTLY_MFA_ENCRYPTION_KEY`, `RESEND_API_KEY`, `CUTLY_EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et `TWILIO_FROM` ou `TWILIO_MESSAGING_SERVICE_SID`. Les SMS de rendez-vous restent désactivés par défaut.

Ne pas définir `CUTLY_DB_PATH` en production. SQLite est réservé au développement local. Le démarrage en mode production refuse les paramètres essentiels absents; `/api/status` expose uniquement les états de configuration.

## Retour arrière

Garder SQLite et sa sauvegarde vérifiée en lecture seule durant la période de contrôle définie. Après les premières écritures sur PostgreSQL, revenir à SQLite ferait perdre les réservations, paiements, audits et mouvements de fidélité créés depuis la bascule. Pour un problème de code, restaurer la version précédente du code en conservant PostgreSQL. Pour une corruption de base, restaurer vers une nouvelle instance, valider son intégrité, puis basculer explicitement la connexion.
