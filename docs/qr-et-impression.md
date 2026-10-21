# QR codes et impression

## Deux familles de QR codes

**QR de ressource** — imprimés une fois, réutilisables pour toutes les parties et toutes les versions de l'enquête :

```
https://votre-domaine.fr/q/lieu/reception
https://votre-domaine.fr/q/indice/IDX-014
https://votre-domaine.fr/q/temoignage/TEM-CAMILLE
https://votre-domaine.fr/q/document/IDX-021
https://votre-domaine.fr/q/enveloppe/ENV-02
https://votre-domaine.fr/q/evenement/EVT-01
```

Les adresses viennent du **registre central des ressources** (table `resources`), indépendant des titres affichés. Au scan :

1. une partie active de cette enquête existe sur le téléphone → la ressource s'ouvre dans cette partie, après vérification côté serveur (étape, prérequis, enveloppe) ;
2. plusieurs parties → le joueur choisit ;
3. aucune → la destination est mémorisée, le joueur rejoint ou crée une partie, puis la carte s'ouvre automatiquement.

Un scan ne donne jamais accès à un secret : un élément pas encore accessible s'affiche « verrouillé » sans contenu. Les scans répétés sont idempotents (une découverte n'est enregistrée qu'une fois par partie, avec son premier découvreur et l'heure réelle).

**QR de session** — l'invitation d'une partie (`/rejoindre/DX-XXXX?i=…`), affiché dans la salle d'attente. Il ne donne aucun droit d'organisateur.

Les joueurs peuvent scanner avec l'appareil photo du téléphone ou avec le bouton « Scanner une carte » (caméra intégrée, HTTPS requis) ; la référence imprimée sous le QR peut aussi être saisie à la main.

## Générer les supports

Administration → **QR & impression** :

- aperçu de toutes les cartes, filtre par type, sélection ;
- export individuel **PNG** (1024 px) ou **SVG** ;
- **PDF A4** : 1, 4, 6, 8 ou 9 cartes par page, repères de découpe facultatifs ;
- chaque carte : DOSSIER X, classification, numéro de dossier, QR, référence, titre ;
- QR vectoriels, correction d'erreur M, zone blanche de 4 modules, noir sur blanc.

## Avant l'impression définitive

1. **Contrôler les destinations** : chaque ressource doit exister dans la dernière version publiée et produire une URL valide.
2. **Tester en ligne** : le serveur appelle chaque adresse via le domaine public et vérifie qu'elle résout la bonne ressource.
3. Le bandeau doit être vert (« Domaine définitif confirmé »). Sinon les planches portent la mention **BROUILLON** : ne les distribuez pas.

## Conseils d'impression

- Papier mat 200 g/m² ou plus, impression à 100 % (désactivez « Ajuster à la page »).
- 6 cartes par page (QR ≈ 5 cm) offre un bon compromis ; ne descendez pas sous 2,5 cm de côté.
- Testez une planche avec deux téléphones différents, en lumière faible, avant d'imprimer tout le jeu.
- Plastifiez de préférence en mat (le brillant crée des reflets qui gênent la lecture).
- Les QR marqués `qr` seul (par exemple IDX-002, IDX-006, IDX-012, IDX-015) ne se découvrent **que** par la carte quand l'option « Cartes physiques » est active : imprimez-les en priorité.
