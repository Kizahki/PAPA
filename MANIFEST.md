# MANIFEST — Vol Asmara

## Zadanie
Application mobile simple (PWA installable, hébergée sur Vercel) pour que le père de l'utilisateur suive le prix des vols EgyptAir Genève (GVA) → Asmara (ASM), aller vers le 16.02.2027, retour vers le 21.03.2027 (Ramadan), dates souples ±2 jours. Notifications si le prix baisse OU passe sous un prix cible. Option : vérifier si 2 valises sont comprises.

## Decyzje Architektoniczne
- PWA vanilla (HTML/CSS/JS) + Vercel Functions Node (dossier `api/`) — pas de framework : léger, rapide, rien à maintenir.
- Source des prix : SerpApi, moteur `google_flights` (données Google Flights), filtre `include_airlines=MS`, CHF, `gl=ch`, `hl=fr`. Plan gratuit 250 recherches/mois.
- Budget recherches : grille 5×5 = 25 combinaisons. Cron quotidien = combinaison de référence (16.02/21.03) + 3 combinaisons les plus anciennes → ~124/mois. Actualisation manuelle : référence seule, 2/jour max. Remplissage initial complet unique (25).
- Stockage : Upstash Redis (intégration Vercel Marketplace, gratuite). Repli mémoire en local.
- Notifications : Web Push (VAPID, lib `web-push`). iPhone : iOS 16.4+ et app ajoutée à l'écran d'accueil.
- Bagages : règle officielle EgyptAir — depuis le 01.01.2026, 1 seule valise en soute pour tout billet de/vers Asmara. Affichée en clair + indices Google Flights si présents. Pas de prix inventé pour la 2e valise.
- Design : mode Operate, lisibilité senior (Atkinson Hyperlegible, gros chiffres, contraste fort). Effets Magic UI reproduits en vanilla : number ticker, blur-fade.

## Stack Technologiczny
Node 20+ (Vercel), `web-push` (seule dépendance). Redis via API REST Upstash en `fetch` (aucune lib). Front : HTML/CSS/JS sans build.

## Known Risks
- Google Flights/SerpApi peut ne pas renvoyer d'offre EgyptAir certains jours → on garde le dernier prix connu, horodaté.
- Prix Google Flights ≠ prix final EgyptAir (taxes/tarif) → toujours vérifier avant d'acheter.
- Endpoints publics : actualisation limitée à 2/jour pour protéger le quota ; cron protégé par CRON_SECRET.
- Cron Vercel Hobby : 1×/jour, exécution dans l'heure.

## Open Questions
- Comptes SerpApi et Vercel à créer par l'utilisateur (clés non disponibles ici).

## QA (27.10.2026)
- Tests logiques `npm test` : parsing SerpApi (filtre EgyptAir, prix min, indices bagages), 1er relevé sans alerte, alerte baisse, alerte cible unique, validation prix cible — OK.
- Quota manuel bloqué à la 3e tentative — OK.
- Rendu 390 px clair/sombre vérifié, pas de défilement horizontal ; détecteur design : 0 alerte.
- Non testé ici : vraie clé SerpApi, push réel sur appareil (nécessite le déploiement).
