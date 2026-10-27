# Vol Asmara

Application mobile (PWA) qui suit le prix des vols **EgyptAir Genève ⇄ Asmara** aller-retour.
Dates par défaut : **16.02.2027 → 21.03.2027** (Ramadan), modifiables dans l'app.

- Le prix aller-retour en direct pour les dates choisies, affiché comme un billet.
- Les dates d'aller et de retour se choisissent dans l'app.
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

### 4. Vérifier l'alerte (facultatif)
Ouvrir une fois `https://TON-APP.vercel.app/api/cron?secret=TON_CRON_SECRET` : la page affiche le prix du jour (1 recherche).

### 5. Sur le téléphone de ton père
- **iPhone** (iOS 16.4 ou plus) : ouvrir l'adresse dans **Safari** → bouton *Partager* → **Sur l'écran d'accueil**. Ouvrir l'app depuis l'icône, puis **Activer les alertes**. (Sur iPhone, les alertes ne marchent que depuis l'icône de l'écran d'accueil.)
- **Android** : ouvrir dans Chrome → **Installer** (bandeau ou menu ⋮) → **Activer les alertes**.
- Toucher **Envoyer un essai** pour vérifier que la notification arrive.

---

## Fonctionnement et quota

- **Prix en direct** : à chaque ouverture de l'app, une recherche pour les dates choisies. Un prix de moins d'une heure est réutilisé (pas de recherche en plus).
- **Alerte** : chaque matin, une recherche silencieuse (cron Vercel). Notification seulement si le prix baisse d'au moins 10 CHF, ou passe sous le prix cible.
- **Dates** : changeables dans l'app, 3 fois par jour maximum.

| Quand | Recherches max |
|---|---|
| Alerte du matin | 1 / jour |
| Ouvertures de l'app | 7 / jour (au-delà, dernier prix connu) |
| Bouton « chercher maintenant » | 3 / jour, compris dans les 7 |

Au maximum ≈ 240 recherches/mois, sous la limite gratuite de 250. Réglages dans `lib/config.js`.

## Limites à connaître
- Les prix viennent de Google Flights : ce sont des **prix indicatifs**. Le prix final est celui d'EgyptAir au paiement.
- Certains jours, Google Flights peut ne pas proposer EgyptAir : l'app garde alors le dernier prix connu et l'indique.
- Bagages : depuis le 01.01.2026, EgyptAir n'inclut qu'une valise en soute pour Asmara. La 2e est payante.

## Tester en local
```bash
npm run dev     # http://localhost:3000, prix fictifs
npm test        # tests de la logique (parsing, alertes, quota)
```
