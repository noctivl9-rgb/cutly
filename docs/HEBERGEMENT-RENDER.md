# Mettre CUTLY en ligne gratuitement : Render + Neon

Netlify (offre gratuite) bloque le site jusqu'au **6 novembre 2026** : les crédits du mois sont épuisés.
Cette solution ne coûte rien et ne demande aucune carte bancaire :

- **Render** (offre *Free*) fait tourner le serveur CUTLY tel quel ;
- **Neon** (offre *Free*) fournit la base PostgreSQL.

Limites de l'offre gratuite de Render :

- le site **se met en veille après 15 minutes sans visite** ; la visite suivante attend environ 1 minute ;
- pendant la veille, les rappels de rendez-vous attendent le réveil du site.

Les valeurs à coller sont dans `data/render-variables.txt` (fichier local, jamais publié).

## 1. Base de données (Neon), 3 minutes

1. Va sur https://neon.tech, clique **Sign up** et connecte-toi avec Google ou GitHub.
2. Crée un projet nommé `cutly`, région **Europe (Frankfurt)**.
3. Dans **Connection string**, copie la ligne qui commence par `postgresql://` (elle contient `sslmode=require`).

La base est vide : CUTLY crée lui-même ses tables au premier démarrage, ainsi que les prestations et les horaires de Thomas Shop.

## 2. Site (Render), 5 minutes

1. Va sur https://render.com, clique **Get Started** et connecte-toi avec **GitHub** (le compte qui contient `noctivl9-rgb/cutly`).
2. Clique **New** → **Blueprint**, choisis le dépôt `cutly`, puis valide : Render lit le fichier `render.yaml`.
3. Render demande les valeurs manquantes ; colle celles de `data/render-variables.txt` :
   - `CUTLY_DATABASE_URL` : la chaîne Neon de l'étape 1 ;
   - `CUTLY_BOOTSTRAP_ADMIN_EMAIL` : ton e-mail (l'administrateur est créé automatiquement) ;
   - `CUTLY_ADMIN_LINKS` : la ligne déjà prête dans le fichier ;
   - `BREVO_API_KEY` et `CUTLY_EMAIL_FROM` : ta clé Brevo et ton adresse d'expédition validée dans Brevo.
4. Clique **Apply**. Le premier démarrage prend 3 à 5 minutes. Render affiche ensuite l'adresse du site, par exemple `https://cutly.onrender.com`.

## 3. Accès administrateur sans identifiant

Dans `data/render-variables.txt`, remplace `ADRESSE` par l'adresse donnée par Render, puis ouvre ton lien.
Tu arrives directement dans l'administration. Ensuite, sur cet appareil, `/admin` s'ouvre tout seul.
Le second lien est pour ton associé.

- Le bouton **Déconnexion** fait oublier le lien à l'appareil.
- Pour désactiver un lien : dans Render → **Environment** → `CUTLY_ADMIN_LINKS`, supprime l'entrée `moi:…` ou `associe:…`.

## 4. Vérifier les e-mails

Dans l'administration → **E-mails** → **Envoyer un e-mail de test**. La réponse affichée sous le bouton dit si Brevo a accepté
le message ou pourquoi il l'a refusé. Regarde ensuite ta boîte de réception et le dossier Spam.

## Revenir sur Netlify plus tard

Le code reste compatible avec Netlify. À partir du 6 novembre, une seule publication Netlify suffit
(`netlify deploy --prod`). Regroupe les changements : chaque publication consomme des crédits.
