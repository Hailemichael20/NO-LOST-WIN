# NO-LOST-WIN
IT IS FOR A GOOD FROM A GOOD WILL 

## Firebase setup

Copy `.env.example` to `.env.local` and replace every Firebase placeholder with the web app configuration from Firebase Console. Do not commit `.env.local`; it contains environment-specific settings.

The Firebase web API key is expected to be present in the browser. In Google Cloud Console, restrict it to the APIs this app uses and to your production domain plus `localhost` during development. This protects the key from unrelated use; Firestore and Storage rules protect the data.

## Production values

Set these values in `.env.local` before deploying:

- `VITE_PAYMENT_TELEBIRR`: the real Telebirr receiving number
- `VITE_PAYMENT_CBE`: the real CBE receiving account number

The admin page is available at `/admin`, but it does not use a client-side password. Grant the Firebase Auth user a custom claim named `admin` with the boolean value `true` using a trusted server or Firebase Admin SDK. Then sign out and back in so the refreshed ID token contains the claim. Firestore and Storage rules enforce the same claim.

Example trusted Admin SDK operation:

```js
await getAuth().setCustomUserClaims('FIREBASE_USER_UID', { admin: true });
```

Do not put service-account credentials or the custom-claim operation in the browser. Enable Email/Password authentication in Firebase Authentication, install the backend dependencies with `cd functions && npm install`, deploy `firestore.rules` and `storage.rules`, and then deploy the built app and function with `npm run build` followed by `firebase deploy --only hosting,firestore,storage,functions`.

Receipt approval is handled by the `approveReceipt` callable function in `functions/index.js`. It verifies the admin claim and atomically marks the receipt approved, credits `users/{uid}.winBirrBalance`, and creates a matching `walletTransactions/{entryId}` record. The wallet transaction ID is the receipt ID, which makes retries idempotent.

## Telegram receipt alerts through Vercel

The Vercel endpoint at `/api/notify-receipt` sends a Telegram alert after a signed-in user uploads a receipt. The `/api/approve-receipt` endpoint securely performs the administrator approval and wallet transaction, so Firebase Cloud Functions are not required. Create a Telegram bot with `@BotFather`, send it one message from your Telegram account, and get your numeric chat ID. Deploy this repository to Vercel and add these Vercel environment variables for Production, Preview, and Development:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

The Firebase service-account values are server-only Vercel variables. Do not add them to browser-exposed `VITE_` variables. `FIREBASE_PRIVATE_KEY` must preserve newlines or use `\\n` sequences. This alert is sent to you for review; it does not approve or credit the wallet. Wallet credit still requires administrator approval in the admin dashboard.
