# CUTLY — état de préparation à la production

Dernière vérification locale : 13 octobre 2026.

## État général

**Préparation en cours — CUTLY n’est pas prêt à recevoir des clients.** Le dépôt GitHub est public et le code de préparation Netlify est présent localement. Aucun site Netlify, aucune base PostgreSQL de production, aucune URL publique ni fournisseur transactionnel n’a été configuré.

| Domaine | État | Détail |
|---|---|---|
| GitHub | PUBLIÉ PRÉCÉDEMMENT | `https://github.com/noctivl9-rgb/cutly`, branche `main`. Les changements Netlify de cette session ne sont pas poussés. |
| Contrôles locaux | RÉUSSIS | `npm run check`, 26 tests, `npm audit --omit=dev` : 0 vulnérabilité signalée. |
| Adaptateur Netlify | TESTÉ LOCALEMENT | Fonction HTTP et routes santé/statut testées sans démarrer de listener. Pas de déploiement Netlify réel. |
| Réservation | TESTÉE SUR SQLITE | Règles, créneaux, concurrence, transitions et parcours compte couverts localement. Aucune validation PostgreSQL réelle. |
| Compte administrateur | INITIALISÉ LOCALEMENT | MFA local présent ; cela ne configure pas l’administrateur de production. |
| E-mail/SMS | NON CONFIGURÉS | Resend et Twilio absents ; vérifications réelles et réservations clientes restent bloquées. |
| PostgreSQL | PRÉPARÉ, NON TESTÉ | Adaptateur et migration existent ; aucune instance PostgreSQL réelle n’a été validée. |
| Migration des données | NON EXÉCUTÉE | SQLite locale conservée intacte ; sauvegarde de migration et transfert restent à faire. |
| Netlify | CODE PRÉPARÉ, COMPTE NON CONNECTÉ | `netlify.toml` et fonction serverless présents ; aucun site ni base Netlify créé. |
| Domaine/HTTPS | EN ATTENTE | URL publique Netlify non attribuée ; domaine personnalisé non choisi. |
| Rappels | NON OPÉRATIONNELS | Le traitement opportuniste de la file ne remplace pas un worker planifié fiable. Le quota de base Free rend la cadence nécessaire problématique. |
| RGPD | VALIDATION REQUISE | Durées de conservation, sous-traitants, notices et suppression/anonymisation à valider juridiquement. |
| Sauvegarde/surveillance | PARTIELLEMENT PRÉPARÉ | Scripts et documentation existent ; aucune sauvegarde/restauration PostgreSQL de production ni alerte n’a été vérifiée. |

## Vérifications réellement exécutées

- `npm run check` : réussi après les changements Netlify.
- `npm test` : 26 tests réussis, 0 échec.
- `npm audit --omit=dev` : 0 vulnérabilité signalée.
- Le test de la fonction Netlify a exercé `/healthz` et `/api/status` dans un processus isolé avec SQLite temporaire.
- Aucun test PostgreSQL, fournisseur e-mail/SMS réel ou déploiement Netlify n’a été effectué.
- `git` n’est pas reconnu par le shell actuellement exposé ; aucun état Git ou nouveau commit n’a pu être vérifié depuis cet environnement.

## Coût et limites du choix Netlify

Netlify affiche son plan Free à **0 USD/mois**, avec 300 crédits/mois et une limite stricte. Un déploiement de production coûte 15 crédits. PostgreSQL facture les crédits selon le calcul et la bande passante ; la base Free est limitée à 48 unités de calcul par période, 5 Go écrits, 5 Go de bande passante, 5 Go de stockage, et s’endort après 5 minutes d’inactivité. La base offre 3 jours de rétention de sauvegarde planifiée et la sauvegarde du dernier déploiement publié. L’épuisement des crédits peut interrompre les ressources ; le plan gratuit ne recharge pas automatiquement. Le tarif actuel du stockage après le 1er juillet 2026 doit être contrôlé dans Netlify avant de créer la base.

Les sources Netlify indiquent également que les fonctions planifiées sont disponibles, mais un réveil assez fréquent pour des rappels proches de 24 h et 2 h peut consommer trop de calcul PostgreSQL ; un rythme plus rare risque de retarder les rappels. Cela empêche de garantir à la fois zéro dépense, un service toujours disponible et des rappels ponctuels sur cette architecture gratuite sans mesure réelle et solution d’exécution durable.

Sources : [crédits et plans Netlify](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [limites et facturation Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/), [fonctions planifiées](https://docs.netlify.com/build/functions/scheduled-functions/).

## À faire avant ouverture aux clients

1. Connecter le dépôt à un compte Netlify et examiner la configuration de build sans publier avant accord de lancement.
2. Décider si les limites strictes et les interruptions possibles du niveau gratuit sont acceptables ; vérifier les frais de stockage actuels avant de créer PostgreSQL.
3. Créer PostgreSQL, sauvegarder et contrôler SQLite, puis exécuter la migration vers une cible vide et vérifier les données.
4. Configurer l’URL HTTPS et les variables secrètes Netlify : `NETLIFY_DB_URL`, `CUTLY_PUBLIC_BASE_URL`, `CUTLY_MFA_ENCRYPTION_KEY`, `RESEND_API_KEY`, `CUTLY_EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et un expéditeur Twilio.
5. Tester les parcours en environnement de prévisualisation avec PostgreSQL et des comptes/fournisseurs configurés.
6. Mettre en place un processus durable de notification/rappels, puis prouver qu’il fonctionne dans les limites du budget choisi.
7. Initialiser l’administrateur de production avec MFA ; valider juridiquement RGPD, rétention et sous-traitants.
8. Tester une vraie restauration PostgreSQL, la surveillance et le retour arrière.
9. Autoriser explicitement la publication publique. Aucune publication ou dépense n’a été faite ici.

## Lancement local

À la racine du projet : `npm start`, puis ouvrir <http://127.0.0.1:3000>. Cette adresse n’est pas publique. Le statut local est visible à `/api/status`.
