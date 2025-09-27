# Tracker d’habitudes & Pratique délibérée — V1 (GitHub Pages + Firebase)

Cette V1 est **100% front** (HTML/JS modules), déployable sur GitHub Pages, avec **Firestore** et **auth anonyme**.

## Dossiers & fichiers
```
/code-tracking-prod
├── index.html
├── app.js
├── schema.js
├── modes.js
├── goals.js
├── firestore.rules
└── firebase.json (optionnel si vous utilisez GitHub Pages)
```

## Pré-requis Firebase
1. Créez (ou réutilisez) un projet Firebase.
2. Activez **Authentication → Sign-in method → Anonymous**.
3. Activez **Firestore** en mode production.
4. Dans *Project settings → Web app*, ajoutez votre app et copiez la config dans `index.html` (déjà préremplie ici).
5. Définissez les **règles Firestore** (`firestore.rules`) dans la console.

> ⚠️ **Sécurité V1** : l’accès aux données est strictement lié au `auth.uid` (utilisateur anonyme, lié à l’appareil/navigateur). Le “lien unique /u/slug” est décoratif en V1. Pour multi‑appareils, prévoir V1.5 avec **Auth par e‑mail (magic link)** ou un mécanisme d’export/import.

## Déploiement GitHub Pages
1. Créez un repo `code-tracking-prod` et poussez ces fichiers.
2. Activez **Pages** (branche `main`, racine `/`).  
3. L’URL `https://<user>.github.io/code-tracking-prod/` sert d’app.

## Fonctionnalités couvertes
- Modes **Journalier** et **Pratique** avec **répétition espacée** (Oui = +1, Plutôt oui = +0.5, sinon 0).
  - Journalier : masquage **N jours** (N = score entier).
  - Pratique : masquage **N sessions** (décrémenté à chaque nouvelle session).
- Priorités (haute, moyenne, basse) + section masquées.
- Historique avec filtre et export simple via copier/coller (CSV à venir).
- **Objectifs** (hebdo/mensuel/annuel) + saisie + graphe simple + liens vers consignes.
- Notifications push **Firebase Cloud Messaging** :
  - Enregistrement des tokens FCM côté client (foreground & background) via `firebase-messaging-sw.js`.
  - Envoi serveur via les Cloud Functions `dispatchPushNotification` (tokens, UID, topics/conditions) et `manageTopicSubscriptions`.
  - Nettoyage automatique des tokens expirés ou non enregistrés.

### API Cloud Functions

- `dispatchPushNotification` — `POST https://<region>-<project>.cloudfunctions.net/dispatchPushNotification`
  - `target`: `{ type: "tokens" | "uid" | "topic" | "condition", ... }`
  - `notification`, `data`, `webpush`: payloads FCM classiques (toutes les valeurs sont normalisées en chaînes).
  - `dryRun`: `true` pour un envoi à blanc.
- `manageTopicSubscriptions` — `POST https://<region>-<project>.cloudfunctions.net/manageTopicSubscriptions`
  - `action`: `subscribe` (défaut) ou `unsubscribe`
  - `topic`: identifiant de topic FCM.
  - `tokens`: tableau de tokens d’enregistrement.

- `sendDailyRemindersScheduled` — tâche planifiée (Europe/Paris, 6h00) qui exécute `sendDailyRemindersHandler` sans requête HTTP. Cette fonction remplace les déclenchements manuels quotidiens ; conservez l’endpoint `sendDailyReminders` uniquement si un appel manuel reste nécessaire.

Les réponses renvoient les compteurs `successCount`, `failureCount`, la liste des `invalidTokens`, ainsi que l’identifiant du message pour les topics/conditions.

## Roadmap rapide
- Export CSV / PDF (V2).
- Notifications (e‑mail/push) si Auth e‑mail activée.
- Comparaison intra‑journée (sessions).
- Tableau comparatif Objectifs ↔ Consignes liées (graphes consolidés).
