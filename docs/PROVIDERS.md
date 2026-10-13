# Configuration des fournisseurs CUTLY

Cette procédure n’a créé aucun compte ni envoyé de message. Les noms des variables sont aussi listés dans `.env.example`.

## Resend — e-mails transactionnels

1. Créer/choisir le compte Resend et ajouter un domaine d’envoi que le propriétaire de CUTLY contrôle.
2. Dans Resend, ouvrir la configuration du domaine et copier **les valeurs DNS exactes affichées par Resend** dans le gestionnaire DNS du domaine. Ne pas reprendre de valeurs depuis un exemple générique.
3. Attendre l’état vérifié de SPF/DKIM dans Resend. Ajouter DMARC selon la politique du domaine et suivre les rapports avant d’appliquer une politique restrictive.
4. Créer une clé API limitée aux besoins d’envoi, la placer dans `RESEND_API_KEY` du gestionnaire de secrets et choisir un expéditeur vérifié dans `CUTLY_EMAIL_FROM` (ex. `CUTLY <rendezvous@domaine-contrôlé>`).
5. Envoyer un test à une adresse maîtrisée après configuration; contrôler réponse API, message reçu, en-têtes SPF/DKIM et dossier spam.

L’adaptateur confirme l’acceptation API de Resend, ce qui ne garantit pas à lui seul la livraison finale. Les erreurs et les tentatives sont consignées dans l’outbox locale; aucune webhook Resend de livraison/désabonnement n’est configurée.

## Twilio — SMS

1. Créer/choisir un compte Twilio et vérifier l’identité du compte.
2. Dans la console, choisir un numéro compatible pour la France ou un Messaging Service, suivre les exigences réglementaires et l’enregistrement de l’expéditeur indiqués par Twilio.
3. Ajouter `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, et l’un de `TWILIO_FROM` (format international E.164) ou `TWILIO_MESSAGING_SERVICE_SID` dans le gestionnaire de secrets.
4. Si les deux expéditeurs sont renseignés, CUTLY choisit le Messaging Service SID.
5. Tester vers un téléphone autorisé; contrôler les identifiants de message et états dans la console Twilio. Les erreurs d’envoi et les réponses incertaines ne sont pas maquillées en succès.

Les SMS d’inscription/verrouillage sont déclenchés par le parcours de vérification. Les SMS de rendez-vous et rappels sont désactivés par défaut; après accord sur les coûts, activer `CUTLY_SMS_APPOINTMENT_NOTIFICATIONS=true`. Une issue réseau incertaine marque l’outbox `FAILED` sans renvoi automatique pour éviter un SMS dupliqué; vérifier l’identifiant/état dans Twilio avant toute relance manuelle. L’acceptation par Twilio est enregistrée, mais les webhooks de livraison finale ne sont pas configurés.

Ne pas mettre les clés dans le navigateur, `.env.example`, Git, captures d’écran ou journaux. Une erreur réseau après soumission peut avoir un résultat incertain; éviter de répéter manuellement une demande avant d’inspecter la console du fournisseur.

## URL et tests

Configurer `CUTLY_PUBLIC_BASE_URL` en `https://...` pour la production avant de démarrer avec `NODE_ENV=production`. Le démarrage de production refuse de se lancer si la clé MFA, l’URL HTTPS ou l’un des deux fournisseurs est absent. Après avoir renseigné les variables dans un environnement isolé, tester inscription e-mail/SMS, clic à usage unique, récupération et envois d’événements depuis une boîte/téléphone de contrôle.

Le statut `/api/status` expose uniquement les états `CONFIGURED`/`NOT_CONFIGURED` et les codes de blocage; il ne renvoie aucune valeur de secret.
