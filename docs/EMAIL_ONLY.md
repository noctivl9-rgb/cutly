# Politique de vérification au lancement

Décision du propriétaire : le client doit vérifier son adresse e-mail avant de réserver. Il doit également fournir un numéro de téléphone au format international afin que Thomas puisse le contacter. Le numéro n'est pas vérifié par SMS. Aucun SMS n'est requis ni envoyé dans le parcours de lancement.

Le serveur applique ces règles lors de la réservation. La politique est centralisée dans `lib/verification-policy.js`. Les comptes existants ne sont pas modifiés automatiquement.

Resend n'est pas encore configuré : les liens d'inscription et de récupération ne peuvent pas encore être envoyés en réel. Aucun envoi fictif n'est présenté comme réussi. L'administration conserve son MFA.
