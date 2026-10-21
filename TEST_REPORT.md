# Rapport de tests — DOSSIER X

Date : 21 octobre 2026 · Node.js 24.20.0 · Windows 11 · PostgreSQL 18.6 (PGlite 0.5.10)

Aucun résultat n'est simulé. Les tests automatisés démarrent le vrai serveur HTTP sur une vraie base PostgreSQL (PGlite, sur disque temporaire) et passent par l'API publique, comme le navigateur.

```bash
npm test        # 20 tests, 20 réussis, 0 échec
npm run typecheck   # aucune erreur
```

## 1. Tests automatisés (cahier des charges §22)

| # | Test | Résultat | Ce qui est vérifié |
|---|---|---|---|
| 1 | Création réelle d'une partie | ✅ Réussi | Code `DX-XXXX` unique en base, jeton organisateur distinct, titre récupéré automatiquement, le code seul ne donne aucun droit organisateur |
| 2 | Connexion de six joueurs | ✅ Réussi | Six inscriptions, septième refusée (partie complète) |
| 3 | Attribution unique des personnages | ✅ Réussi | 8 inscriptions simultanées sur le même personnage → 1 seule acceptée ; personnage marqué indisponible ; attribution automatique → 6 personnages distincts |
| 4 | Reconnexion après fermeture | ✅ Réussi | Jeton conservé → état retrouvé ; prénom seul refusé ; code personnel → nouveau jeton, ancien révoqué |
| 5 | Scan QR de lieu | ✅ Réussi | Refus avant lancement, ouverture du lieu, lieu d'étape 2 verrouillé, clé inconnue → 404 |
| 6 | Scan QR d'indice | ✅ Réussi | Carte physique découverte, indice d'étape 2 verrouillé sans contenu, prérequis respecté, saisie manuelle de la référence |
| 7 | Découverte persistante | ✅ Réussi | Serveur arrêté puis relancé sur la même base : découverte, découvreur et heure conservés |
| 8 | Synchronisation | ✅ Réussi | Un joueur fouille → un autre reçoit l'événement en direct ; reconnexion avec le dernier identifiant → événement manqué rejoué |
| 9 | Isolation entre parties | ✅ Réussi | Joueur d'une partie refusé sur l'état, le scan et le flux d'une autre ; organisateur d'une partie refusé sur une autre ; aucune fuite de découvertes |
| 10 | Confidentialité des secrets | ✅ Réussi | Réponse réseau d'un joueur : sa fiche présente, fiches/secrets des 5 autres absents, solution absente, enveloppe scellée et indices non découverts absents ; fichiers JS servis sans la vérité ; API publiques sans secret ; partage d'une information d'un autre personnage refusé ; partage enregistré (auteur, personnage, partie) |
| 11 | Déblocage d'enveloppe | ✅ Réussi | Joueur refusé ; organisateur ouvre ; ouverture idempotente (1 seul événement) ; document débloqué ajouté au dossier ; notification reçue |
| 12 | Tableau collaboratif | ✅ Réussi | Cartes et liens enregistrés avec auteur ; preuve non découverte refusée ; lien en double refusé ; deux modifications simultanées de la même version → une acceptée, une en conflit (409 avec état courant) ; conflit de notes détecté |
| 13 | Accusation collective | ✅ Réussi | Fermée avant l'étape 3 ; seules les preuves découvertes retenues ; soumission refusée tant qu'un joueur n'a pas approuvé ; double soumission refusée. **13b** : mode vote (majorité) et porte-parole (seul le désigné soumet) |
| 14 | Révélation contrôlée | ✅ Réussi | Après soumission : ni solution ni score ; joueur refusé ; révélation par l'organisateur → solution, résultat, chronologie de la vérité ; mode révélation automatique explicite |
| 15 | PDF A4 | ✅ Réussi | `%PDF`…`%%EOF`, MediaBox 595,28 × 841,89 pt, nombre de pages = ⌈49 / 6⌉, sélection d'une carte → 1 page ; sans domaine confirmé, impression définitive refusée |
| 16 | Lecture des QR exportés | ✅ Réussi | Les 49 QR PNG décodés par jsQR → URL attendue → résolue vers la bonne ressource ; SVG valide |
| 17 | Protection des routes admin | ✅ Réussi | 6 routes admin refusées sans jeton, avec jeton organisateur, avec faux jeton ; auteur sans accès aux parties ; limitation des tentatives de connexion (429) ; version publiée immuable ; nouveau brouillon publié sans modifier une partie en cours ; nouvelles parties sur la version 2 |
| 18 | Actions simultanées | ✅ Réussi | 6 scans + 6 fouilles simultanés → aucune découverte ni notification en double ; journal trié numériquement ; pause → actions refusées (423), lecture possible ; enveloppe ouverte pendant une déconnexion rattrapée ; progression automatique concurrente → l'étape n'avance qu'une fois |
| + | Cohérence du scénario | ✅ Réussi | Validation sans erreur ; preuves clés accessibles sans impression ; un seul coupable ; partie complète jouée jusqu'aux aveux, toutes les preuves clés découvertes |

## 2. Parcours manuel dans le navigateur (exécuté)

Navigateur Chromium intégré, un seul appareil ; les cinq autres joueurs et l'organisateur agissaient par l'API pendant que le navigateur jouait le sixième personnage.

| Parcours | Résultat |
|---|---|
| Accueil, création de partie (formulaire complet) → console organisateur | ✅ |
| Rejoindre : titre automatique, personnages pris indiqués, code personnel affiché | ✅ |
| Salle d'attente mise à jour en direct à l'arrivée des autres joueurs | ✅ |
| Lancement par l'organisateur → le téléphone passe au dossier sans rechargement | ✅ |
| Plan interactif (lieux verrouillés hachurés), fiche de lieu, fouille, pièce découverte | ✅ |
| Découvertes des autres joueurs reçues en direct (notifications, compteurs du plan) | ✅ |
| Étape 2 débloquée automatiquement, lieux déverrouillés en direct, enveloppe ouverte visible | ✅ |
| Placer une preuve au tableau, fiche personnage, partage volontaire d'un secret | ✅ |
| Chronologie filtrée par personnage | ✅ |
| Accusation collective : brouillon, 6/6 approbations, soumission, attente de révélation | ✅ |
| Révélation : coupable, score (97/100), conclusion, rôle des preuves | ✅ |
| Administration : enquêtes, 49 cartes QR, contrôle des destinations, PDF généré | ✅ |
| Largeur 375 px : aucun débordement horizontal sur l'accueil, la création, les 5 onglets, la console | ✅ |

**Défaut trouvé et corrigé pendant ce parcours** : le journal et le rattrapage triaient les événements selon leur identifiant converti en texte (« 17 » avant « 9 »). Corrigé (`order by game_events.id`) et couvert par une assertion de régression dans le test 18.

**Incident d'outillage, non imputable à l'application** : avec deux onglets ouverts dans le navigateur d'automatisation, dont la fenêtre ne s'affichait pas, des clics destinés à l'onglet joueur ont été reçus par la console organisateur en arrière-plan (étapes, pause, fin de partie — visibles dans le journal d'audit). La suite du parcours a été menée dans un seul onglet sans réapparition. Les actions organisateur exigent un clic et, pour les actions importantes, une confirmation.

## 3. Non exécuté — à faire avant une mise en service

| Test | Pourquoi | Comment le faire |
|---|---|---|
| Six vrais téléphones simultanés (iOS Safari, Android Chrome) | Un seul navigateur disponible | Déployer sur le domaine public, une partie à six, vérifier reconnexion après verrouillage d'écran et changement Wi-Fi/4G |
| Scan des QR **imprimés** avec des téléphones | Ni imprimante ni téléphone | Imprimer une planche à 100 %, scanner en lumière faible avec deux modèles |
| Lecture des QR **dans le PDF** | Pas de rendu PDF disponible ; les PNG du même code sont décodés (test 16) | Contrôle visuel + scan d'une planche imprimée |
| PostgreSQL réseau (Neon, Supabase) | Aucun accès réseau à une base pendant le développement (le connecteur Neon demande une autorisation) | Le serveur de test utilise `DATABASE_URL` s'il est défini : lancer `npm test` sur une base **vierge et dédiée** (le test 17 publie une version 2 de l'enquête), puis rejouer le parcours navigateur. Le SQL est identique, mais ce n'est pas vérifié |
| Concurrence réelle multi-connexions | PGlite sérialise les transactions ; l'unicité repose sur des contraintes et verrous `FOR UPDATE` valables en PostgreSQL réseau, mais la contention réelle n'a pas été mesurée | Rejouer les tests 3 et 18 contre PostgreSQL réseau |
| Scanner intégré (caméra) | Exige HTTPS et une caméra | Sur le domaine public, bouton « Scanner une carte » |
| Installation PWA | Exige HTTPS | Chrome Android « Installer », Safari « Sur l'écran d'accueil » |
| Revue visuelle du design | Les captures d'écran du navigateur intégré étaient indisponibles (fenêtre non affichée) ; la mise en page a été contrôlée par la structure de la page et les mesures de débordement, pas à l'œil | Ouvrir le site sur téléphone et ordinateur |
| Accessibilité outillée (axe, lecteur d'écran) | Non outillé dans ce projet | Audit Lighthouse/axe, VoiceOver |
| Performance sur téléphone milieu de gamme | Pas d'appareil | Lighthouse mobile sur le domaine public |
