# E-mails CUTLY — fonctionnement, configuration, vérification

## Ce que fait le système

Tous les e-mails passent par une **file d'envoi en base** (« transactional outbox ») : un événement (inscription, demande, décision de Thomas…) écrit une ligne dans `notification_outbox` **dans la même transaction** que le changement qu'il annonce. Un envoi qui échoue ne bloque donc jamais une réservation, et un rendez-vous n'est jamais créé en double à cause d'un e-mail.

| Étape | Où | Rôle |
|---|---|---|
| Événement | `lib/booking.js`, `appointments.js`, `cancellations.js`, `accounts.js`, `server.js` | écrit la ligne (clé anti-doublon `dedupe_key`) |
| Modèles | `lib/email-templates.js` | HTML (tableaux, styles en ligne, mode sombre, repli Outlook) + texte brut |
| Envoi | `lib/notifications.js` → `lib/providers.js` | relit l'état réel du rendez-vous, rend le modèle, envoie, enregistre le reçu |
| Reprises | `processOutbox` | 5 tentatives (attente croissante) ; clé/domaine refusés : attente 30 min sans épuiser les tentatives (48 h) ; adresse refusée : abandon immédiat |
| Rappels | `refreshAppointmentReminders` + `netlify/functions/send-notifications.mjs` | 24 h et 2 h avant un rendez-vous **confirmé**, état relu juste avant l'envoi |
| Suivi | `POST /api/webhooks/resend` | met à jour « livré », « retardé », « rebond », « plainte » |
| Historique | `GET /api/admin/notifications` (administrateur) | état de chaque message, sans contenu ni lien |

### États d'un message

`PENDING` (préparé) → `RETRYING` pendant l'envoi → `SENT` + `provider_status = ACCEPTED` (**accepté par le fournisseur, pas encore livré**) → `DELIVERED` / `DELAYED` / `BOUNCED` / `COMPLAINED` (événements du webhook). Autres : `REJECTED` (adresse refusée), `FAILED`, `SUPPRESSED` (adresse en rebond définitif, plus aucun envoi), `SUPERSEDED` (rendez-vous modifié entre-temps : message abandonné), `NOT_APPLICABLE` (pas d'e-mail prévu pour ce statut).

> « Livré » n'est jamais déduit d'une réponse positive de l'API d'envoi : seul un événement du fournisseur le positionne.

### E-mails envoyés

Compte : vérification (« Confirmez votre adresse e-mail — CUTLY »), bienvenue (une seule fois, à la première vérification), mot de passe oublié.
Client : demande reçue (statut **en attente**), rendez-vous confirmé, demande non acceptée (avec lien pour un autre créneau), rendez-vous annulé, demande d'annulation reçue, annulation acceptée / non acceptée, rappel 24 h, rappel 2 h, rendez-vous modifié.
Thomas : nouvelle demande, demande d'annulation à traiter.
Aucune adresse de salon n'est inscrite dans les e-mails : seules les données du rendez-vous (prestation, date, heure, durée, prix, professionnel) y figurent.

## Fournisseur : Resend (conservé)

Resend est **déjà intégré** (API REST, clé d'idempotence, webhooks signés, offre gratuite). Brevo et Postmark conviennent aussi, mais changer n'apporterait rien ici : un nouveau fournisseur à intégrer et à tester pour les mêmes besoins. Vérifier les limites de l'offre gratuite sur https://resend.com/pricing avant le lancement.

## Ce qu'il faut configurer (rien de tout cela n'est fait aujourd'hui)

1. **Clé API valide.** La clé actuellement enregistrée est refusée par Resend (« API key is invalid »). Créer une clé « Sending access » sur https://resend.com/api-keys, puis :
   ```bash
   netlify env:set RESEND_API_KEY <la-clé> --secret
   ```
2. **Domaine d'envoi authentifié.** Sans domaine vérifié, Resend n'autorise que l'envoi vers l'adresse du propriétaire du compte : aucun client ne recevrait rien. Ajouter votre domaine sur https://resend.com/domains, puis créer **exactement** les enregistrements DNS affichés :
   - **SPF** (TXT) et **MX** de retour (rebonds) sur le sous-domaine d'envoi ;
   - **DKIM** (TXT `resend._domainkey…`) ;
   - **DMARC** (TXT `_dmarc`), à commencer en observation : `v=DMARC1; p=none; rua=mailto:vous@votredomaine.fr`, à durcir (`quarantine`) après quelques semaines sans anomalie.
3. **Adresse d'expédition** sur ce domaine :
   ```bash
   netlify env:set CUTLY_EMAIL_FROM "CUTLY <rendez-vous@votredomaine.fr>"
   netlify env:set CUTLY_EMAIL_REPLY_TO "contact@votredomaine.fr"   # facultatif
   ```
4. **Webhook de suivi.** Dans Resend → Webhooks, ajouter `https://cutlyt.netlify.app/api/webhooks/resend` (événements : delivered, delivery_delayed, bounced, complained, failed, suppressed), copier le secret `whsec_…` :
   ```bash
   netlify env:set RESEND_WEBHOOK_SECRET <whsec_…> --secret
   ```
5. `CUTLY_PUBLIC_BASE_URL` (déjà définie), puis **republier** le site : les variables ne s'appliquent qu'au déploiement suivant.

Sans clé valide, rien n'est « simulé » : les messages restent en file (`RETRYING`, erreur `email_provider_configuration_rejected`) pendant 48 h et partent dès que la clé est corrigée. Passé ce délai, ils passent en `FAILED`.

## Rappels automatiques

`send-notifications.mjs` est une tâche planifiée Netlify : toutes les 30 minutes, **du vendredi au dimanche, de 05 h à 17 h (UTC)**. Choix volontaire pour ménager le quota de calcul gratuit de la base Netlify (elle se rendort après 5 minutes). Conséquences à connaître :
- couvre le samedi et le dimanche (09 h–19 h) et la veille pour les rappels de 24 h ;
- **si Thomas ouvre d'autres jours, élargir le cron** (`config.schedule` dans ce fichier), sinon ces rappels partiraient en retard ;
- les e-mails immédiats ne dépendent pas de cette tâche : ils partent juste après la requête qui les crée.
Les heures sont calculées en instants absolus (24 h et 2 h réelles) : le changement d'heure ne décale rien, et l'heure affichée est toujours celle de Paris.

## Vérifier sans rien envoyer aux clients

- `npm run preview:emails` écrit un aperçu HTML de chaque modèle dans `data/email-previews/` (données fictives).
- `CUTLY_EMAIL_TRANSPORT=file` (développement uniquement, **ignoré en production et sur Netlify**) écrit les e-mails dans `data/email-outbox.jsonl` au lieu de les envoyer.
- Boîtes de test Resend, une fois la clé valide : `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev` simulent une livraison, un rebond et une plainte sans toucher de vrai client.

## Niveau de vérification (honnêteté)

| Élément | Niveau |
|---|---|
| Modèles, objets, personnalisation, échappement, heure de Paris, texte brut | **Test automatisé réussi** (`test/notifications.test.js`) |
| File d'envoi, reprises, doublons, états, rebonds, webhook signé | **Test automatisé réussi** avec transport simulé |
| Parcours inscription → lien → bienvenue → mot de passe → réservation → décision → annulation → webhook | **Test de bout en bout réussi** dans Chrome, transport fichier (`e2e/emails.spec.mjs`) |
| Envoi réel par Resend / acceptation par le fournisseur | **Non vérifié** : aucune clé valide |
| Livraison confirmée dans une boîte | **Non vérifié** |
| Rendu dans Gmail, Outlook, Apple Mail | **Non vérifié** : seul le rendu Chrome (ordinateur, mobile, mode sombre, images bloquées) a été contrôlé |
| Rappels aux heures réelles en production | Logique testée ; **tâche planifiée non observée** sur Netlify |
