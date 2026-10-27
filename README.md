# Vol Asmara

Application mobile (PWA) qui suit le prix des vols **EgyptAir Genève ⇄ Asmara** pour le Ramadan 2027 :
départ autour du **16.02.2027**, retour autour du **21.03.2027**, ±2 jours.

- Le meilleur prix sur 25 combinaisons de dates, affiché comme un billet.
- La grille des dates : toucher une case affiche ce billet.
- Réponse claire sur les valises : **1 seule valise en soute comprise** (règle EgyptAir pour Asmara depuis le 01.01.2026).
- Notification quand le prix baisse (≥ 10 CHF) **ou** passe sous le prix cible.
- Fonctionne hors ligne avec les derniers prix connus.

---

## Mise en ligne (≈ 20 minutes, une seule fois)

### 1. Clé des prix : SerpApi (gratuit)
1. Créer un compte sur <https://serpapi.com> (plan gratuit : 250 recherches/mois).
2. Copier la clé dans *Dashboard → Your Private API Key*.

### 2. Clés des notifications
Sur un ordinateur avec Node installé :
```bash
npx web-push generate-vapid-keys
```
Garder la *Public Key* et la *Private Key*.

### 3. Déployer sur Vercel
1. Mettre ce dossier dans un dépôt GitHub (privé, c'est mieux).
2. Sur <https://vercel.com> → **Add New → Project** → importer le dépôt. *Framework Preset* : **Other**. Déployer.
3. Dans le projet : **Storage → Create Database → Upstash for Redis** (plan gratuit) → **Connect** au projet. Les variables Redis s'ajoutent toutes seules.
4. **Settings → Environment Variables**, ajouter :

| Nom | Valeur |
|---|---|
| `SERPAPI_KEY` | la clé SerpApi |
| `VAPID_PUBLIC_KEY` | la clé publique |
| `VAPID_PRIVATE_KEY` | la clé privée |
| `VAPID_SUBJECT` | `mailto:ton.email@exemple.ch` |
| `CRON_SECRET` | un mot de passe inventé (long) |

5. **Deployments → … → Redeploy** pour prendre les variables en compte.

### 4. Premier relevé complet (une fois)
Ouvrir dans le navigateur :
```
https://TON-APP.vercel.app/api/cron?full=1&secret=TON_CRON_SECRET
```
Cela remplit les 25 cases de la grille (25 recherches). Ensuite tout est automatique.

### 5. Sur le téléphone de ton père
- **iPhone** (iOS 16.4 ou plus) : ouvrir l'adresse dans **Safari** → bouton *Partager* → **Sur l'écran d'accueil**. Ouvrir l'app depuis l'icône, puis **Activer les alertes**. (Sur iPhone, les alertes ne marchent que depuis l'icône de l'écran d'accueil.)
- **Android** : ouvrir dans Chrome → **Installer** (bandeau ou menu ⋮) → **Activer les alertes**.
- Toucher **Envoyer un essai** pour vérifier que la notification arrive.

---

## Fonctionnement et quota

| Quand | Recherches |
|---|---|
| Chaque matin vers 6 h–7 h (cron Vercel) | 4 : dates prévues + les 3 cases les plus anciennes |
| Bouton actualiser (dates prévues) | 1, max 2 par jour |
| Premier relevé complet | 25, une fois |

≈ 125–185 recherches/mois, sous la limite gratuite de 250. Toute la grille est rafraîchie tous les ~8 jours, les dates prévues tous les jours.
Réglages dans `lib/config.js` (dates, quota, seuil de baisse).

## Limites à connaître
- Les prix viennent de Google Flights : ce sont des **prix indicatifs**. Le prix final est celui d'EgyptAir au paiement.
- Certains jours, Google Flights peut ne pas proposer EgyptAir : l'app garde alors le dernier prix connu et l'indique.
- Le prix de la 2e valise n'est pas publié de façon fiable : à demander à EgyptAir avant d'acheter.

## Tester en local
```bash
npm run dev     # http://localhost:3000, prix fictifs
npm test        # tests de la logique (parsing, alertes, quota)
```
