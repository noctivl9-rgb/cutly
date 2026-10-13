# CUTLY — corrections et préparation à budget initial nul

Rapport du 13 octobre 2026. Statut global : **PARTIELLEMENT TERMINÉ, lancement public BLOQUÉ**.

## Résultats réels

- `npm run check` : contrôle syntaxique réussi.
- `npm test` avec `CUTLY_TEST_POSTGRES_URL` et `CUTLY_TEST_PG_BIN` : **38 tests réussis, aucun échec, aucun ignoré**.
- Sans ces variables, le test PostgreSQL est explicitement ignoré. Ne pas considérer cette exécution comme une validation PostgreSQL.
- PostgreSQL 18.6 portable, cluster temporaire exclusivement local : migration depuis une SQLite de test, comparaison de chaque champ, concurrence sur deux connexions, insertion concurrente directe, idempotence, rappels, limite de tentatives partagée, sauvegarde `pg_dump` puis restauration `pg_restore` dans une nouvelle base.
- `npm audit --omit=dev` : aucune vulnérabilité connue signalée. Ce contrôle n'est pas un audit de sécurité exhaustif.
- Adaptateur HTTP Netlify testé localement. Aucun build distant ou déploiement Netlify réalisé. Pas de commande `build` dédiée : fichiers statiques et fonction Node ; le bundling hébergeur reste à vérifier.
- Notifications : transports de test explicitement injectés. Aucun véritable e-mail ni SMS envoyé.
- PWA : ressources HTTP et comportement du service worker testés. Installation réelle iOS/Android et accessibilité complète NON TESTÉES.

## Corrections apportées

1. Conservation des noms camelCase des champs SQL dans PostgreSQL.
2. Verrou de création de réservation partagé avec la modification ; sérialisation des demandes portant la même clé d'idempotence.
3. Réservation réservée aux comptes CLIENT vérifiés et aux prestations de l'établissement demandé (Thomas Shop par défaut).
4. Rappels SMS : heure d'envoi enregistrée. Une actualisation répétée ne désactive plus les rappels de la version courante.
5. Avant envoi d'un rappel, contrôle du statut CONFIRMED, de la version et de la date. Les rappels obsolètes sont écartés.
6. Après un arrêt pendant l'envoi d'un SMS, résultat incertain conservé pour examen au lieu d'une répétition automatique susceptible de facturer un doublon.
7. Erreurs fournisseur assainies, exception de construction du message contenue ; OTP court en GSM ASCII.
8. Limites de tentatives persistées en base, communes aux instances. Migration additive numéro 7, aucune donnée métier supprimée.
9. Point d'entrée POST `/api/internal/notifications`, protégé par un jeton aléatoire de 32 caractères minimum, comparaison à temps constant. Non activé sans secret.
10. En-têtes de sécurité des fichiers statiques préparés pour Netlify.
11. Migration SQLite vers PostgreSQL refusant une destination occupée, sauvegarde préalable, comparaison des valeurs et retour arrière transactionnel en cas de différence.
12. Script `backup:postgres` sans écrasement, secret absent des arguments et validation de lecture de l'archive. Restauration complète effectivement testée sur des données de test.
13. Installation PWA, icônes, page hors connexion et cache limité aux ressources publiques. Aucun cache des API ou des comptes.

Les comptes, rendez-vous, horaires et données SQLite de travail n'ont pas été migrés ni réinitialisés. La nouvelle migration sera appliquée au prochain démarrage du nouveau code : faire une sauvegarde vérifiée avant ce démarrage.

## Fichiers concernés

- Configuration : `.env.example`, `.gitignore`, `netlify.toml`, `package.json`.
- Serveur et données : `server.js`, `db/postgres/schema.sql`, `lib/database.js`, `lib/booking.js`, `lib/appointments.js`, `lib/notifications.js`, `lib/providers.js`.
- Nouveaux modules : `lib/rate-limit.js`, `lib/scheduled-jobs.js`.
- Scripts : `scripts/bootstrap-admin.js`, `scripts/migrate-sqlite-to-postgres.js`, nouveau `scripts/backup-postgres.js`.
- Interface et PWA : `public/index.html`, `public/manifest.webmanifest`, `public/pwa.js`, `public/service-worker.js`, `public/install.html`, `public/install.css`, `public/offline.html`, trois icônes PNG dans `public/icons/`.
- Tests : `test/integration.test.js`, nouveaux `test/postgres.test.js`, `test/pwa.test.js`, `test/scheduled-jobs.test.js`.
- Documentation : `README.md`, `PRODUCTION_READINESS.md`, `docs/DEPLOYMENT.md`, `docs/NETLIFY_DEPLOYMENT.md`, présent rapport.

## Architecture gratuite retenue pour les essais

**Netlify Free + Neon Free**, avec sous-domaine `netlify.app`, code Node existant et PostgreSQL. Aucun compte créé et aucun service connecté pendant cette intervention. Cette sélection est une recommandation pour les essais, pas une garantie de continuité commerciale à 0 €.

| Service | Offre et limites vérifiées | Décision |
|---|---|---|
| Netlify Free | 300 crédits/mois, plafond strict sans recharge ; consommation des fonctions et déploiements | Conserver l'adaptateur existant. Vérifier que le compte est bien Free avant import ; ne pas activer d'option payante. |
| Neon Free | 1 Go par projet, 100 CU-heures/mois, restauration instantanée sur 6 h | Meilleur candidat de test parmi les options examinées ; sauvegarde externe indispensable. 100 CU-heures ne signifient pas 100 heures d'horloge. |
| Render Free | Mise en veille après 15 min, stockage local éphémère, PostgreSQL gratuit expirant après 30 jours | Non retenu pour conserver les réservations en production. |
| Supabase Free | 500 Mo, pause possible après 7 jours de faible activité, sauvegardes personnelles à organiser | Alternative, aucune connexion préparée spécifiquement au-delà du protocole PostgreSQL. |
| Resend Free | 100 e-mails/jour ; domaine expéditeur à vérifier | Intégration existante conservée. Compte et domaine expéditeur disponibles non confirmés. |
| Brevo Free | 300 e-mails/jour, sans carte selon le fournisseur, restrictions/branding | Alternative étudiée ; adaptateur non implémenté ni testé. |
| cron-job.org | Gratuit, POST et en-têtes personnalisés, échéance maximum d'exécution de 30 s | Candidat pour le point d'entrée protégé. Non configuré. La fréquence réveille la base et consomme les quotas. |
| UptimeRobot Free | 50 moniteurs, contrôles toutes les 5 min, usage commercial admis | Candidat pour `/healthz`, non configuré. Surveiller aussi les erreurs de tâches. |

Sources officielles consultées : [Netlify](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [Neon](https://neon.com/blog/neon-free-plan-1-gb-per-project), [Render](https://render.com/docs/free), [Supabase taille](https://supabase.com/docs/guides/platform/database-size), [Supabase pauses](https://supabase.com/docs/guides/platform/free-project-pausing), [Resend](https://resend.com/pricing), [Brevo](https://www.brevo.com/products/transactional-email/), [cron-job.org](https://cron-job.org/en/faq/), [UptimeRobot](https://help.uptimerobot.com/en/articles/11604710-who-should-use-uptimerobot-s-free-plan).

Les conditions de carte bancaire, restrictions régionales et quotas exacts du compte doivent encore être contrôlés dans chaque inscription. Aucune promesse de gratuité illimitée. Ne pas renseigner de moyen de paiement ou basculer vers un plan facturé sans accord.

## Coût bloquant : vérification téléphonique

Aucune solution étudiée n'a établi une vérification SMS durable, gratuite, pour tous les nouveaux clients. L'essai Twilio est limité et ne remplace pas une configuration commerciale. Tarif officiel France consulté : **0,0798 USD par segment sortant** ; 100 OTP d'un segment représentent environ **7,98 USD**, hors taxes, frais additionnels éventuels et location éventuelle d'expéditeur. Les renvois comptent aussi. L'intégration actuelle utilise SMS Messaging, pas Twilio Verify.

Sources : [tarifs France](https://www.twilio.com/en-us/sms/pricing/fr/), [essai Twilio](https://www.twilio.com/docs/usage/trials). La page Plivo France a aussi été consultée, mais son tarif dynamique n'a pas été récupéré de façon exploitable ; aucun prix concurrent supposé n'est annoncé.

La double vérification reste obligatoire. Avec le budget strict de 0 €, conserver le projet en essais sans ouverture des réservations publiques. Un domaine expéditeur déjà possédé peut éviter un nouvel achat ; un sous-domaine Netlify ne donne pas le contrôle DNS nécessaire à Resend.

## Actions exactes avant une URL publique fonctionnelle

1. Valider le traitement du coût SMS et disposer d'un domaine expéditeur vérifiable. Aucune clé ou mot de passe à coller dans le chat.
2. Fournir l'accès autorisé à un dépôt GitHub privé cible. Le dépôt précédemment associé est public ; aucun changement de visibilité et aucun push n'ont été faits ici. La branche locale préparée est `cutly/production-readiness-local`.
3. Après autorisation d'envoi, pousser le code vérifié vers ce dépôt, puis créer le projet Netlify sans déclencher de publication prématurée. L'import peut lancer un déploiement : cette étape nécessite l'accord de publication.
4. Créer une base Neon distincte pour la préproduction, région adaptée, accès TLS et utilisateur applicatif limité. Stocker sa connexion dans `CUTLY_DATABASE_URL`, pool réduit via `CUTLY_DB_POOL_MAX=2`.
5. Sauvegarder SQLite ; exécuter `npm run migrate:sqlite-to-postgres -- --sqlite CHEMIN_SOURCE --backup CHEMIN_NOUVEAU` avec la connexion cible dans l'environnement, destination vide. Suspendre les écritures pendant la bascule ; conserver la source et la sauvegarde intactes. Comparer les données après migration.
6. Renseigner uniquement dans le gestionnaire de secrets : `NODE_ENV=production`, `CUTLY_PUBLIC_BASE_URL`, `CUTLY_MFA_ENCRYPTION_KEY`, `RESEND_API_KEY`, `CUTLY_EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` ou `TWILIO_MESSAGING_SERVICE_SID`, et `CUTLY_JOB_TOKEN`. Les secrets d'exécution ne doivent pas être injectés dans les tests de build. Garder `CUTLY_SMS_APPOINTMENT_NOTIFICATIONS=false` pour limiter les SMS aux vérifications.
7. Initialiser Thomas avec `npm run bootstrap:admin`, e-mail réel et MFA. Conserver la clé de chiffrement MFA existante si les comptes sont migrés.
8. Configurer le planificateur : POST HTTPS `/api/internal/notifications`, en-tête Authorization Bearer venant du coffre de secrets. Mesurer la durée et les quotas, tester un rappel 24 h et 2 h, annulation, modification, panne et reprise. L'endpoint traite au maximum 20 messages ; adapter la cadence et le lot si la limite d'exécution du fournisseur est atteinte. Pas de promesse d'envoi exactement à la seconde ou exactement une fois.
9. Programmer les sauvegardes hors base, protéger/chiffrer leur stockage, valider la rétention. `npm run backup:postgres -- CHEMIN_NOUVEAU.dump` utilise `CUTLY_PG_BIN` si les utilitaires PostgreSQL ne sont pas dans PATH. Restaurer périodiquement dans une nouvelle base vide avec `pg_restore --exit-on-error --no-owner`, connexion fournie par environnement. Ne jamais utiliser `--clean` contre une base réelle.
10. Configurer surveillance, alertes, budget et procédure de reprise ; vérifier l'expéditeur et les vrais envois, les parcours complets, les protections et les téléphones. Obtenir la validation juridique.
11. Après accord explicite de publication et validation des contrôles, déployer et transmettre l'URL réellement retournée par Netlify. Aucune URL publique CUTLY fonctionnelle n'est disponible à ce stade.

## Risques et travail restant

- Fiabilité et plafonds des offres gratuites à mesurer ; polling fréquent susceptible d'épuiser Neon Free. Le planificateur et le stockage externe des sauvegardes ne sont pas configurés.
- Les envois acceptés par un fournisseur ne prouvent pas leur réception finale. Une annulation survenant pendant un envoi déjà parti ne peut pas le rappeler. Surveillance manuelle des SMS au résultat incertain nécessaire.
- Le code demeure un lancement Thomas Shop : pas de gestion publique multi-établissements, de professionnels multiples ou de rôle plateforme activé. Les limites actuelles de fidélité doivent être revues avant toute extension.
- Traductions anglaises, installation iOS/Android, responsive réel et audit WCAG complet restent à finaliser/vérifier. Pas de validation visuelle complète effectuée dans cette intervention.
- Les limites IP doivent être validées derrière le proxy choisi ; aucune confiance automatique accordée à un en-tête transféré arbitraire. Les quotas par compte sont partagés en base.
- Conservation, suppression/anonymisation et documents RGPD nécessitent validation juridique. Aucun statut de conformité légale accordé.
- L'environnement de test PostgreSQL ne prouve pas le fonctionnement distant, les droits minimaux, TLS, les temps de réponse ni la capacité de l'offre gratuite.
- Le serveur local déjà actif peut charger une ancienne version. Aucun deuxième serveur permanent lancé. Après sauvegarde, relancer volontairement avec `npm start` pour charger les corrections ; les tests ont démarré leurs propres instances temporaires.

## Checklist

- [x] Corrections de réservation, rappels et compatibilité PostgreSQL testées localement.
- [x] Sauvegarde puis restauration de données de test vérifiées.
- [x] PWA préparée et comportement de cache testé.
- [x] Configuration de déploiement et secrets documentés.
- [ ] Fournisseurs réels, domaine expéditeur et budget SMS validés.
- [ ] Base distante, sauvegardes automatiques, surveillance et planificateur connectés.
- [ ] Parcours réels en ligne et installation sur appareils validés.
- [ ] Validation juridique et décision d'ouverture.
- [ ] Autorisation de push vers dépôt privé et de publication.
