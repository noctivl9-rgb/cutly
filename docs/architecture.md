# Architecture CUTLY — état au 13 octobre 2026

## Architecture actuelle

- Monolithe Node.js natif, routes HTTP JSON et pages statiques, sans dépendance npm tierce. SQLite natif sert de source de vérité pour une instance locale unique.
- Les tables et migrations (versions 1 à 6) sont initialisées par `server.js`. La migration 6 ajoute les reçus fournisseur d’outbox. Les rendez-vous conservent les snapshots de prestation et les dates UTC avec le fuseau `Europe/Paris`.
- `lib/booking.js` valide le compte vérifié, les horaires, le service, l’idempotence et les conflits dans une transaction; les triggers SQLite empêchent les chevauchements actifs. La route HTTP cliente est active et exige une session.
- `lib/accounts.js` gère les challenges e-mail/téléphone et les jetons de récupération; `lib/providers.js` contient les adaptateurs Resend et Twilio. Tant que les secrets et l’URL publique ne sont pas configurés, ces parcours échouent explicitement.
- `lib/notifications.js` maintient une outbox transactionnelle, des messages e-mail et des SMS de rendez-vous optionnels, un worker périodique, des reçus avec identifiants fournisseur et les rappels 24 h / 2 h. Les SMS rendez-vous sont désactivés par défaut; l’acceptation fournisseur reste différente de la livraison finale.
- `lib/auth.js` utilise scrypt, des sessions à jeton aléatoire haché, cookies HttpOnly/SameSite, TOTP administrateur et secret MFA chiffré AES-256-GCM. Le serveur en production refuse de démarrer avec une clé MFA, un e-mail/SMS ou une origine HTTPS absents.
- `lib/appointments.js`, `lib/cancellations.js`, `lib/payments.js`, `lib/loyalty.js` couvrent transitions autorisées, annulations, paiements sur place et ledger/récompenses. Une récompense réservée est restaurée lors d'une annulation, d'un refus ou d'un NO_SHOW; elle n'est consommée qu'après COMPLETED. Les corrections de paiement sont ajoutées comme événements immuables avec motif obligatoire et auteur horodaté.
- `lib/dashboard.js` calcule les statistiques depuis les données de l’établissement. Les pages admin offrent les opérations disponibles et le journal d’audit.

## Configuration des services externes

Variables requises pour les fonctions clientes réelles :

- `CUTLY_PUBLIC_BASE_URL` : origine HTTPS publique et stable en production.
- `RESEND_API_KEY`, `CUTLY_EMAIL_FROM` : envoi e-mail transactionnel; le domaine d’envoi doit être validé auprès du fournisseur.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et soit `TWILIO_FROM`, soit `TWILIO_MESSAGING_SERVICE_SID` : SMS Twilio, avec expéditeur et destination conformes au pays.
- `CUTLY_MFA_ENCRYPTION_KEY` : clé base64 décodant en 32 octets; elle doit rester stable pour déchiffrer le MFA de l’administrateur.

Ne pas placer ces valeurs dans le dépôt. L’absence de configuration n’est pas remplacée par un transport simulé.

## Sauvegarde locale

`npm run backup -- <chemin-nouveau-fichier.sqlite>` crée une nouvelle copie cohérente via SQLite `VACUUM INTO`, vérifie `PRAGMA integrity_check` et refuse d’écraser une destination. Cette commande ne planifie pas de sauvegardes et ne protège pas une copie hors site. Tester périodiquement une restauration avant production.

## Limites avant production

- Serveur local sur `127.0.0.1`. Netlify est la cible serverless préparée avec `netlify.toml` et `netlify/functions/api.js`; aucun site ni URL publique configuré.
- SQLite mono-instance et limiteurs en mémoire ne conviennent pas à un déploiement horizontal. Choisir une base gérée, des limites distribuées, un gestionnaire de secrets et une stratégie de migration/rollback avant l’exploitation commerciale.
- Script de sauvegarde testée localement ajouté; aucun job planifié, stockage hors site, surveillance ou système d’alerte de production n’est configuré.
- La page de confidentialité est un brouillon. Les fondements, durées, identité du responsable, sous-traitants et politique d’effacement exigent validation juridique.
- Les avis ne peuvent être soumis que par le client propriétaire d'un rendez-vous COMPLETED de Thomas Shop. Ils restent PENDING_MODERATION jusqu'à la décision de Thomas; approbations et masquages sont audités. La politique de conservation est cadrée dans `docs/DATA_RETENTION.md` sans durée automatique avant validation juridique.
