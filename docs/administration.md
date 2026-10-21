# Guide d'administration et d'organisation

## Les trois niveaux de droits

| Rôle | Comment l'obtenir | Ce qu'il permet |
|---|---|---|
| Administrateur global (`superadmin`) | `DX_ADMIN_EMAIL`/`DX_ADMIN_PASSWORD` au premier démarrage, `npm run admin:create`, ou Administration → Journal & comptes | Tout : enquêtes, parties de tous les groupes, impression, audit, comptes |
| Auteur (`author`) | Créé par un administrateur global | Créer et publier des enquêtes, générer les QR codes ; ne voit pas les parties |
| Organisateur d'une partie | Créer une partie depuis l'accueil | Piloter **cette** partie uniquement, via son jeton secret |
| Joueur | Rejoindre avec le code ou le QR d'invitation | Sa partie, son personnage |

Le code `DX-XXXX` sert uniquement à rejoindre : il ne donne aucun droit d'organisateur.

## Organiser une partie

1. **Accueil → Créer une partie.** Choisissez les options. Vous arrivez sur la console organisateur ; le jeton est conservé sur cet appareil.
2. Pour piloter depuis un autre appareil, ouvrez « Lien organisateur secret » dans la salle d'attente et transmettez ce lien à vous-même uniquement.
3. Faites scanner le **QR d'invitation** (ou donnez le code). Les joueurs choisissent pseudonyme et personnage ; chacun reçoit un **code personnel** à noter.
4. Quand les conditions sont remplies (nombre minimal de joueurs, personnages attribués), **Lancer la partie**. Vous pouvez forcer le lancement.
5. Pendant la partie :
   - **Progression** : en mode automatique, les étapes se débloquent selon les preuves ; vous pouvez toujours débloquer ou revenir à une étape.
   - **Enveloppes** : ouvrez-les au bon moment (suggestion pour le Grand Hôtel : n° 1 dès le début, n° 2 à l'étape 2, n° 3 et n° 4 à l'étape 3).
   - **Événements** et **annonces** : apparaissent immédiatement sur tous les téléphones.
   - **Joueurs** : réattribuer un personnage, générer un nouveau code personnel (téléphone perdu), désigner le porte-parole, retirer un joueur.
   - **Pause** : les joueurs consultent leur dossier mais ne peuvent plus agir.
6. **Accusation** : selon le mode choisi (collective, vote, porte-parole). Vous pouvez clore et soumettre au nom du groupe.
7. **Révéler la solution** : la conclusion, le rôle de chaque preuve, les mensonges et la chronologie complète s'affichent pour tous.
8. **Exporter** : fichier JSON de la partie (sans aucun jeton).

La section « Vérité interne » de la console contient la solution et les fiches secrètes : ne la montrez pas aux joueurs.

## Situations courantes

| Situation | Que faire |
|---|---|
| Un joueur a fermé son navigateur | Il rouvre le site : « Reprendre mon enquête » (identité conservée sur l'appareil) |
| Un joueur change de téléphone | Accueil → Récupérer mon accès, avec le code de partie et son code personnel |
| Code personnel perdu | Console → joueur → « … » → Générer un nouveau code personnel |
| Un joueur a rejoint la mauvaise partie | Avant le lancement il peut « Quitter cette partie » ; après, retirez-le depuis la console |
| Réseau instable | L'indicateur passe à « Reconnexion » ; tout est rattrapé à la reconnexion |
| Plusieurs groupes en même temps | Créez une partie par groupe : chacune a son code, son dossier, ses découvertes |

## Administration

- **Enquêtes** : voir [Créer une enquête](creer-une-enquete.md).
- **Parties** : liste de toutes les parties, accès à leur console (administrateur global).
- **QR & impression** : voir [QR codes et impression](qr-et-impression.md).
- **Journal & comptes** : opérations sensibles (connexions, publications, ouvertures d'enveloppes, révélations, exports, partages…) et création de comptes.
