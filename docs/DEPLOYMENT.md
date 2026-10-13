# Préparation du déploiement Render

## État

Le fichier render.yaml décrit maintenant un service Node à Francfort et une base PostgreSQL managée distincte. La base utilise le plan 0.5 CPU / 1 GB, PostgreSQL 18 et refuse les connexions externes par défaut. Le service utilise le plan 0.5 CPU / 512 MB et récupère l’URL privée de la base avec fromDatabase. Le runtime Node est fixé par .node-version.

Ces plans sont payants. Le Blueprint n’a pas été synchronisé : aucun compte Render n’a été connecté et aucune ressource n’a été créée. Vérifier le tarif courant et le budget dans Render avant toute synchronisation.

Estimation Render vérifiée le 13 octobre 2026 : environ 7 USD/mois pour le service web, 19 USD/mois pour le PostgreSQL 0.5 CPU / 1 GB et 1,20 USD/mois pour les 4 GB au-delà du premier GB inclus dans un disque de 5 GB. Total de base estimé : 27,20 USD/mois, hors taxes éventuelles, trafic excédentaire, Resend, Twilio et domaine. La tarification peut changer; confirmer dans la console avant création.

Le site reste local. Aucun domaine n’est défini, aucun dépôt Git distant n’est connecté, aucune base de production n’existe et aucun déploiement n’a eu lieu.

## Préconditions

- Dépôt Git privé avec l’accès nécessaire pour le connecter à Render.
- Compte Render et validation explicite des coûts des deux ressources payantes.
- Décision sur le nom de domaine et accès DNS.
- Compte Resend, domaine d’envoi vérifié et secrets à configurer séparément.
- Compte Twilio, expéditeur autorisé et secrets à configurer séparément.
- Adresse e-mail réelle de l’administrateur Thomas et mot de passe robuste.
- Secret MFA de 32 octets stocké dans un gestionnaire de secrets.
- Validation juridique de la politique de confidentialité et des durées de conservation.

Ne jamais coller de secrets dans le chat, le dépôt, les journaux ou les captures.

## Ordre de mise en place

1. Connecter le dépôt Git privé au compte Render et inspecter le plan avant de créer les ressources. Le Blueprint garde l’auto-déploiement désactivé.
2. Créer la base PostgreSQL et vérifier la région, la version et l’option de récupération. La liste IP vide bloque les connexions externes; l’application dans la même région utilise l’URL privée.
3. Avant le premier démarrage de l’application, décider si les données SQLite locales doivent être importées. Si oui, suivre docs/POSTGRESQL_MIGRATION.md avec une sauvegarde vérifiée et un accès externe temporaire limité à l’adresse IP du poste. Ne pas démarrer l’application avant la migration : son initialisation crée le schéma de la base cible et le script de migration exige une cible vide.
4. Après validation de la migration et des comptes à conserver, connecter le service à la base, puis renseigner les secrets dans Render. Le domaine public doit être fixé avant de renseigner CUTLY_PUBLIC_BASE_URL en HTTPS.
5. Lancer un déploiement de contrôle seulement après l’autorisation explicite de publication. Vérifier /healthz et /api/status; booking doit rester BLOCKED jusqu’à l’initialisation MFA et la configuration réelle des fournisseurs.
6. Initialiser le compte administrateur final une seule fois avec npm run bootstrap:admin. Conserver le secret TOTP dans un gestionnaire sécurisé puis retirer immédiatement les variables temporaires de bootstrap.
7. Tester les parcours de vérification réels Resend/Twilio, la réservation, l’administration, les rappels et les alertes avant d’ouvrir le site aux clients.

## Configuration sensible

Le Blueprint crée CUTLY_DATABASE_URL via l’URL PostgreSQL privée de Render. Les valeurs sync:false doivent être configurées dans le gestionnaire de secrets de Render : CUTLY_PUBLIC_BASE_URL, CUTLY_MFA_ENCRYPTION_KEY, RESEND_API_KEY, CUTLY_EMAIL_FROM, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et un expéditeur TWILIO_FROM ou TWILIO_MESSAGING_SERVICE_SID. Les SMS de rendez-vous restent désactivés par défaut.

Ne pas ajouter CUTLY_DB_PATH au service de production. SQLite reste le choix du développement local uniquement.

## Retour arrière

Avant bascule, conserver la sauvegarde SQLite vérifiée et l’ancienne base intactes. Après l’import, ne pas redémarrer l’application avec SQLite si des écritures de production ont déjà été faites sur PostgreSQL : cela ferait perdre ces écritures du parcours actif. Un retour arrière après ouverture aux clients exige un plan de réconciliation des nouvelles réservations, paiements, audits et mouvements de fidélité.

Pour un défaut de code sans dommage de données, restaurer la révision précédente du code tout en gardant PostgreSQL. Pour une corruption, effectuer une restauration PostgreSQL vers une nouvelle instance, la vérifier, puis basculer explicitement l’URL après validation.

## Documentation Render

- Blueprint et plans : https://render.com/docs/blueprint-spec
- Connexion à PostgreSQL : https://render.com/docs/postgresql-creating-connecting
- Sauvegardes et restauration PostgreSQL : https://render.com/docs/postgresql-backups
