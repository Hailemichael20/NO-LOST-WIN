# NO-LOST-WIN
IT IS FOR A GOOD FROM A GOOD WILL 

## Firebase setup

Copy `.env.example` to `.env.local` and replace every Firebase placeholder with the web app configuration from Firebase Console. Do not commit `.env.local`; it contains environment-specific settings.

Firebase is used for Authentication and Firestore; receipt images are stored in Cloudinary, so the app does not require a Firebase Storage bucket or Storage billing. The Firebase web API key is expected in the browser. Restrict it to the APIs this app uses and to your production domain plus `localhost` during development. Firestore rules protect user and registration data.

## Production values

Set these values in `.env.local` before deploying:

- `VITE_PAYMENT_TELEBIRR`: the real Telebirr receiving number
- `VITE_PAYMENT_CBE`: the real CBE receiving account number

The admin page is available at `/admin`, but it does not use a client-side password. Grant the Firebase Auth user a custom claim named `admin` with the boolean value `true` using a trusted server or Firebase Admin SDK. Then sign out and back in so the refreshed ID token contains the claim. Firestore rules and the Vercel approval endpoint enforce the admin claim.

Example trusted Admin SDK operation:

```js
await getAuth().setCustomUserClaims('FIREBASE_USER_UID', { admin: true });
```

Do not put service-account credentials or the custom-claim operation in the browser. Enable Email/Password authentication in Firebase Authentication and deploy Firestore rules with `firebase deploy --only firestore:rules`.

Receipt approval is handled by the Vercel endpoint at `/api/approve-receipt`. It verifies the admin claim and atomically marks the receipt approved, credits `users/{uid}.winBirrBalance`, and creates a matching `walletTransactions/{entryId}` record. The wallet transaction ID is the receipt ID, which makes retries idempotent.

## Vercel and Cloudinary

Receipt images upload directly from the browser to Cloudinary. Before each upload, `/api/cloudinary-signature` verifies the Firebase ID token and signs a unique Cloudinary public ID inside that user's `receipts/{uid}` folder. The Cloudinary API secret remains on Vercel. Create a **signed** Cloudinary upload preset that allows JPG, PNG, and WebP images and limits uploads to 5 MB.

The Vercel API reflects only same-origin requests and exact origins listed in `CORS_ALLOWED_ORIGINS`; it does not allow arbitrary origins. The Cloudinary upload endpoint supports browser uploads directly. For local Vite development against a deployed Vercel API, set `VITE_API_BASE_URL` to that Vercel deployment URL and add the exact Vite origin to `CORS_ALLOWED_ORIGINS`. Leave `VITE_API_BASE_URL` empty when the frontend and API are served from the same Vercel deployment.

Create a Telegram bot with `@BotFather`, send it one message from your Telegram account, and get your numeric chat ID if receipt alerts are needed.

### Vercel environment variables

In Vercel Project Settings → Environment Variables, add these server-only values for the environments you deploy:

```text
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-firebase-service-account-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
CLOUDINARY_UPLOAD_PRESET=your-signed-receipts-preset
CORS_ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:5173
```

Use comma-separated, exact origins with no trailing slash. Add the exact Vercel preview or Codespaces forwarded origin when testing from those domains; forwarded Codespaces origins can change. Same-origin production requests do not need to be listed. Do not use `*`.

For local Vite testing against Vercel, add this browser-exposed value to `.env.local`:

```text
VITE_API_BASE_URL=https://your-app.vercel.app
```

Push the project to GitHub, import it in Vercel, add the environment variables, and deploy. Confirm receipt upload and (if configured) Telegram notification from the deployed site.

Firebase service-account credentials and the Cloudinary API secret are server-only Vercel variables. Do not put them in browser-exposed `VITE_` variables. `FIREBASE_PRIVATE_KEY` must preserve newlines or use `\\n` sequences. Telegram alerts are for review only; wallet credit still requires administrator approval in the admin dashboard.
