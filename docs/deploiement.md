# Déploiement et domaine définitif

## 1. Base de données

Créez une base PostgreSQL 14+ (Neon, Supabase, Render Postgres…) et récupérez son URL de connexion :

```
DATABASE_URL=postgresql://utilisateur:motdepasse@hote/base?sslmode=require
```

Les migrations (`db/migrations/*.sql`) s'appliquent automatiquement au démarrage, dans l'ordre, une seule fois (table `schema_migrations`). Le scénario du Grand Hôtel est importé et publié au premier démarrage.

Avec **Supabase** : utilisez la chaîne de connexion « Session pooler » ou directe (pas le mode transaction, qui ne conserve pas les transactions multi-requêtes). La migration `002_rls.sql` active la RLS sur toutes les tables : les clés `anon` et `authenticated` n'ont accès à rien.

## 2. Hébergement de l'application

N'importe quel hébergeur Node.js 22.18+ convient (Render, Railway, Fly.io, VPS).

**Render** : le fichier `render.yaml` décrit le service. Créez un « Blueprint » depuis le dépôt, puis renseignez les variables marquées `sync: false`.

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | URL PostgreSQL |
| `DX_ADMIN_EMAIL` / `DX_ADMIN_PASSWORD` | premier administrateur global (créé si aucun compte n'existe) |
| `PUBLIC_BASE_URL` | `https://votre-domaine.fr` |
| `PRINT_DOMAIN_CONFIRMED` | `false` jusqu'à validation du domaine, puis `true` |
| `TRUST_PROXY` | `1` derrière un proxy |

Commande de démarrage : `node src/server.ts`. Point de santé : `GET /api/health`.

> **Une seule instance.** La diffusion temps réel est en mémoire. Avec plusieurs instances, un joueur connecté à l'instance A ne recevrait pas en direct les événements créés sur l'instance B (il les rattraperait seulement à la reconnexion). Pour passer à plusieurs instances, relayez `publish()` (src/realtime.ts) via `LISTEN/NOTIFY` PostgreSQL. Les offres gratuites qui mettent le service en veille ralentissent la première connexion mais ne perdent aucune donnée.

## 3. Domaine permanent

Les QR codes imprimés contiennent `PUBLIC_BASE_URL`. Ils doivent rester valables pendant toute la vie des cartes :

1. Achetez un domaine que vous contrôlez (ne pas utiliser une adresse de prévisualisation ni un tunnel temporaire).
2. Chez votre hébergeur, ajoutez le domaine personnalisé ; chez votre registraire, créez l'enregistrement DNS demandé (CNAME vers l'hébergeur, ou A/AAAA).
3. Attendez l'émission du certificat HTTPS.
4. Définissez `PUBLIC_BASE_URL=https://votre-domaine.fr` et redémarrez.
5. Dans **Administration → QR & impression**, lancez « Tester en ligne » : chaque adresse doit répondre depuis le domaine public.
6. Seulement alors : `PRINT_DOMAIN_CONFIRMED=true`, redémarrez, générez les planches définitives.

Tant que l'étape 6 n'est pas faite, l'application permet de préparer les cartes, mais les PDF portent la mention **BROUILLON** et le contrôle des destinations refuse l'impression définitive.

Si une route doit changer un jour, n'altérez pas les clés existantes : ajoutez un alias (`POST /api/admin/aliases`), et les anciennes adresses `/qr/...` ou `/r/...` sont redirigées vers `/q/...`.

## 4. Paramètres de sécurité

- En-têtes : CSP stricte (scripts du seul domaine), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`.
- Limitation de débit par adresse IP : création de parties (12/h), inscription (20/min), récupération (8/15 min et 20/15 min par partie), connexion admin (8/15 min), scans (40/min par joueur).
- Jetons : 256 bits aléatoires, seule leur empreinte SHA-256 est stockée. Codes personnels de récupération : 8 caractères (≈ 10¹² combinaisons), empreinte salée par partie, limitation des tentatives.
- Comptes administrateurs : mots de passe scrypt, 12 caractères minimum, sessions de 12 h révocables (déconnexion).
- Rôles : `superadmin` (tout), `author` (enquêtes et impression seulement), organisateur d'une partie (sa partie seulement), joueur (sa partie, sa fiche).
