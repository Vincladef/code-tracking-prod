# Tracker d’habitudes & Pratique délibérée — V1 (GitHub Pages + Firebase)

Cette V1 est **100% front** (HTML/JS modules), déployable sur GitHub Pages, avec **Firestore** et **auth anonyme**.

## Dossiers & fichiers !!!
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

## Pré-requis Firebase !
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

## Notifications e‑mail via SMTP (Gmail)

Les e‑mails sont envoyés par les Cloud Functions via SMTP (TLS) sans dépendance externe. Les déclencheurs déjà présents :

- `onObjectiveWrite` — à la création/mise à jour d’un objectif, si la notification est activée, que la date cible est "aujourd’hui" (contexte Europe/Paris) et que le canal inclut "email" ou "both".
- `sendDailyRemindersScheduled` — envoi quotidien (6h Europe/Paris) des rappels push et e‑mail, avec un e‑mail de résumé aux destinataires admins.

Paramétrage via `functions.config()` (Firebase Functions Runtime Config) attendu par le code côté serveur :

- `mail.host` (ex. `smtp.gmail.com`)
- `mail.port` (ex. `465`)
- `mail.secure` (`true` si port 465)
- `mail.user` (ex. `mon.compte@gmail.com`)
- `mail.pass` (Mot de passe d’application Gmail — pas le mot de passe de compte)
- `mail.from` (ex. `"Mon Nom" <mon.compte@gmail.com>`) 
- `mail.recipients` (optionnel, liste séparée par virgules, destinataires par défaut pour les tests)
- `summary.recipients` (optionnel, liste séparée par virgules pour recevoir le résumé quotidien ; défaut = `mail.recipients` ou un fallback hardcodé)

Important pour Gmail : utilisez un "Mot de passe d’application" (sécurité → Validation en 2 étapes → Mots de passe d’application). Le mot de passe de compte ne fonctionnera pas.

### Configuration manuelle (local ou CI)

En local, si vous avez le CLI Firebase installé et authentifié, exécutez :

```
firebase functions:config:set \
  mail.host="smtp.gmail.com" \
  mail.port="465" \
  mail.secure="true" \
  mail.user="<GMAIL_USER>" \
  mail.pass="<GMAIL_APP_PASS>" \
  mail.from="<Nom> <GMAIL_USER>" \
  summary.recipients="<admin1@example.com>,<admin2@example.com>"
```

Puis déployez :

```
firebase deploy --only functions
```

### Déploiement CI/CD (GitHub Actions)

Un workflow est fourni : `/.github/workflows/deploy-functions.yml`. Configurez ces Secrets GitHub dans votre dépôt :

- `FIREBASE_PROJECT_ID` — ID du projet Firebase
- `FIREBASE_TOKEN` — Token CI (`firebase login:ci`) ou utilisez une identité de service (voir bloc commenté du workflow)
- `MAIL_HOST` — `smtp.gmail.com`
- `MAIL_PORT` — `465`
- `MAIL_SECURE` — `true`
- `MAIL_USER` — votre adresse Gmail
- `MAIL_PASS` — mot de passe d’application Gmail
- `MAIL_FROM` — par ex. `"Mon Nom" <votre@gmail.com>`
- `MAIL_RECIPIENTS` — optionnel, liste séparée par virgules
- `SUMMARY_RECIPIENTS` — optionnel, pour l’email de résumé quotidien

Le job CI applique automatiquement `functions:config:set` avec ces valeurs, puis déploie les Functions. Aucune modification du code n’est requise pour passer sur Gmail : tout est piloté par la configuration.

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
  - Déployez les deux fonctions avec `firebase deploy --only functions:sendDailyReminders,functions:sendDailyRemindersScheduled`.
  - Si les appels manuels ne sont plus utilisés, supprimez l’ancienne fonction HTTP via `firebase functions:delete sendDailyReminders` ou désactivez son invocation dans la console Firebase.

Les réponses renvoient les compteurs `successCount`, `failureCount`, la liste des `invalidTokens`, ainsi que l’identifiant du message pour les topics/conditions.

## Roadmap rapide
- Export CSV / PDF (V2).
- Notifications (e‑mail/push) si Auth e‑mail activée.
- Comparaison intra‑journée (sessions).
- Tableau comparatif Objectifs ↔ Consignes liées (graphes consolidés).
