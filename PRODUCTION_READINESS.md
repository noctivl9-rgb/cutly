# CUTLY — état de préparation à la production

Dernière vérification du code local : 13 octobre 2026.

## État global

**PRÉPARATION TECHNIQUE EN COURS — PAS PRÊT POUR UN LANCEMENT PUBLIC.**

Le code de préparation PostgreSQL et le Blueprint Render sont présents, mais aucune connexion, base Render, ressource d’hébergement, adresse publique ou publication n’existe. Aucun achat ou abonnement n’a été effectué.

| Domaine | État | Vérification |
|---|---|---|
| Réservation, administration, paiements sur place, fidélité et avis | PARTIELLEMENT VÉRIFIÉ | Couvert par les tests locaux SQLite; pas de validation sur PostgreSQL réel. |
| Vérification d’identité par e-mail/SMS | NON CONFIGURÉ | Adaptateurs Resend/Twilio présents; pas de compte, clé ni envoi réel. |
| PostgreSQL | PRÉPARÉ, NON TESTÉ SUR SERVEUR | Schéma, adaptateur et script de migration écrits; aucune URL ni instance PostgreSQL accessible. |
| Migration SQLite réelle | NON EXÉCUTÉE | La base et les données locales n’ont pas été modifiées; aucune sauvegarde réelle n’a été créée par cette préparation. |
| Render | PRÉPARÉ, NON CRÉÉ | Blueprint configuré avec ressources payantes; il n’a pas été synchronisé. |
| Multi-établissement / équipe | PARTIEL | Le schéma porte l’établissement; les routes sont encore centrées sur Thomas Shop et les rendez-vous n’ont pas d’identifiant professionnel distinct. |
| Domaine et HTTPS | EN ATTENTE | Nom de domaine non choisi; URL publique absente. |
| Administrateur de production | EN ATTENTE | L’initialisation sécurisée est disponible; l’adresse réelle et le secret MFA de production ne sont pas renseignés. |
| RGPD | VALIDATION REQUISE | Brouillon et export de données présents; conservation, suppression/anonymisation, sous-traitants et textes nécessitent validation juridique. |
| Sauvegardes et alertes | PARTIELLEMENT PRÉPARÉ | Sauvegarde SQLite vérifiée en test temporaire; aucune sauvegarde de production, rétention hors site, surveillance ou alerte n’est configurée. |
| Git distant | BLOQUÉ | Aucun dépôt Git distant configuré dans cet espace. |

## Vérifications locales exécutées

- npm run check : réussi.
- npm test : 25 tests réussis, 0 échec.
- npm audit --omit=dev : 0 vulnérabilité signalée dans les dépendances de production.
- Les tests tournent sur SQLite temporaire. Ils ne prouvent ni une connexion PostgreSQL, ni un envoi Resend/Twilio, ni un déploiement, ni une restauration de production.
- Aucun build de production séparé ou test multi-navigateurs réel n’a été effectué dans cette passe.

## Coûts et services

Le Blueprint demande un service web et un PostgreSQL managé sur des plans payants. Estimation Render vérifiée le 13 octobre 2026 : environ 7 USD/mois pour le web, 19 USD/mois pour PostgreSQL et 1,20 USD/mois pour le stockage configuré de 5 GB (premier GB inclus), soit environ 27,20 USD/mois hors taxes éventuelles, trafic excédentaire, Resend, Twilio et domaine. Revalider dans la console avant création. Aucun engagement financier n’a été pris.

Render indique que la récupération PITR PostgreSQL est réservée aux plans payants et que la fenêtre dépend du plan d’espace. Les exports logiques manuels sont temporaires. Définir et tester une sauvegarde indépendante avant exploitation : [documentation des sauvegardes Render](https://render.com/docs/postgresql-backups).

## Éléments à fournir ou réaliser avant d’ouvrir CUTLY aux clients

1. Créer un dépôt Git privé et connecter le compte Render, après validation du coût courant des ressources.
2. Choisir le domaine et configurer DNS.
3. Créer/configurer les comptes Resend et Twilio si souhaité; entrer les secrets uniquement dans un gestionnaire de secrets.
4. Décider si les données SQLite existantes doivent être transférées, inspecter les comptes/réservations de la source, puis utiliser une sauvegarde vérifiée et le runbook de migration. La base PostgreSQL doit rester vide avant le premier démarrage de l’application.
5. Réaliser la migration et vérifier réellement les données et contraintes sur une base PostgreSQL.
6. Initialiser et tester le compte administrateur final avec MFA.
7. Faire valider juridiquement la notice, les traitements, les sous-traitants, la conservation et les demandes de droits.
8. Définir rétention et procédure de sauvegarde/restauration, surveillance, alertes et plan de récupération.
9. Tester les parcours de bout en bout et l’accessibilité sur appareils et navigateurs retenus.
10. Autoriser distinctement le déploiement public et toute dépense liée aux services.

## Démarrage local

L’adresse locale est http://127.0.0.1:3000. Pour lancer l’application depuis le dossier du projet : npm start. Cela ne rend pas le site public.

Voir [README.md](README.md), [déploiement Render](docs/DEPLOYMENT.md), [migration PostgreSQL](docs/POSTGRESQL_MIGRATION.md), [sauvegarde/restauration](docs/BACKUP_RESTORE.md) et [configuration des fournisseurs](docs/PROVIDERS.md).
