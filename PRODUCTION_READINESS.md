# CUTLY — état de préparation à la production

Dernière vérification locale : 13 octobre 2026.

## État

**Préparation en cours — CUTLY n’est pas encore prêt à recevoir des clients.** Le code est publié sur GitHub, le serveur local répond, et les contrôles locaux passent. Aucun service Render, aucune base PostgreSQL de production, aucun domaine ni fournisseur transactionnel n’est configuré.

| Domaine | État | Détail |
|---|---|---|
| Dépôt GitHub | PRÉPARÉ ET PUBLIÉ | `https://github.com/noctivl9-rgb/cutly`, branche `main`, commit de référence `e419771`. Dépôt public. |
| Contrôles locaux | RÉUSSIS | `npm run check`, 25 tests, `npm audit --omit=dev` : 0 vulnérabilité signalée. |
| Serveur local | OPÉRATIONNEL | `/healthz` répond 200. `/api/status` répond 200 et signale la réservation bloquée. |
| Réservations | TESTÉES SUR SQLITE | Couverture locale des créneaux, règles, concurrence et transitions. Pas de validation PostgreSQL réelle. |
| Administrateur local | INITIALISÉ | MFA configuré selon `/api/status`; cela ne configure pas un administrateur de production. |
| E-mail et SMS | NON CONFIGURÉS | Resend et Twilio absents; la double vérification et la réservation restent bloquées. |
| PostgreSQL | PRÉPARÉ, NON TESTÉ | Adaptateur et migration écrits; aucune instance PostgreSQL disponible pour tester. |
| Migration des données | NON EXÉCUTÉE | La base SQLite locale demeure intacte; migration réelle et sauvegarde pré-migration restent à faire. |
| Render | PRÉPARÉ, NON CRÉÉ | `render.yaml` prévoit un web service et PostgreSQL payants. Aucun compte/service n’a été connecté ou créé. |
| Domaine/HTTPS | EN ATTENTE | Domaine à choisir; URL HTTPS publique non configurée. |
| RGPD | VALIDATION REQUISE | Conservation, anonymisation/suppression, sous-traitants et textes doivent être validés juridiquement. |
| Sauvegardes et surveillance | PARTIELLEMENT PRÉPARÉ | Scripts et procédure présents; aucune sauvegarde ou restauration PostgreSQL de production, alerte ou supervision active. |

## Vérifications réellement exécutées

- `npm run check` : réussite.
- `npm test` : 25 tests réussis, 0 échec.
- `npm audit --omit=dev` : 0 vulnérabilité signalée.
- `GET /healthz` : HTTP 200, `{"status":"ok"}`.
- `GET /api/status` : HTTP 200; `booking=BLOCKED`, fournisseurs e-mail/SMS et URL HTTPS non configurés, base `SQLITE_LOCAL`.
- La suite de tests n’a pas utilisé une base PostgreSQL ni envoyé de véritables e-mails/SMS.

## Coûts et limite du zéro euro

Le Blueprint actuel demande des plans Render payants. Au relevé officiel du 13 octobre 2026, les plans configurés représentent environ 7 USD/mois pour le web, 19 USD/mois pour PostgreSQL 0,5 CPU/1 GB, puis 1,20 USD/mois pour les 4 GB de stockage au-delà du premier GB inclus : environ **27,20 USD/mois**, hors taxes, trafic et fournisseurs. Le plan Hobby de l’espace Render est à 0 USD/mois; le compute s’ajoute.

Render propose aussi des ressources gratuites, mais elles ne conviennent pas aux données de réservation en production : le service web gratuit s’endort après 15 minutes d’inactivité et le PostgreSQL gratuit expire après 30 jours. Après une période de grâce de 14 jours, Render supprime la base; le plan gratuit n’inclut pas de sauvegardes. Ne pas y importer les données réelles de CUTLY.

Sources officielles : [tarifs Render](https://render.com/pricing), [plans compute](https://render.com/docs/compute-plans), [limitations du niveau gratuit](https://render.com/docs/free).

## À terminer avant ouverture aux clients

1. Décider entre coûts Render payants pour une base durable ou une démo gratuite temporaire sans données réelles.
2. Configurer Resend et Twilio, vérifier l’expéditeur et placer les secrets dans Render.
3. Choisir et configurer le domaine HTTPS.
4. Créer la base PostgreSQL, sauvegarder et inspecter les données SQLite, puis exécuter et vérifier la migration.
5. Tester le schéma, les transactions, les contraintes et les parcours sur une instance PostgreSQL réelle.
6. Initialiser l’administrateur de production et confirmer le MFA, sans réutiliser les identifiants de démonstration.
7. Valider juridiquement les notices, durées de conservation, sous-traitants et parcours des droits RGPD.
8. Mettre en place sauvegardes indépendantes, restauration testée, alertes et procédure d’incident.
9. Exécuter les tests de bout en bout sur l’environnement de validation, puis autoriser distinctement le déploiement public.

## Lancement local

Depuis la racine du dépôt : `npm start`, puis ouvrir `http://127.0.0.1:3000`. Cette adresse n’est pas publique. Le statut actuel est consultable sur `/api/status`.
