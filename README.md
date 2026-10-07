# NO-LOST-WIN
IT IS FOR A GOOD FROM A GOOD WILL 

## Firebase setup

Copy `.env.example` to `.env.local` and replace every Firebase placeholder with the web app configuration from Firebase Console. Do not commit `.env.local`; it contains environment-specific settings.

Firebase is used for Authentication and Firestore; receipt images are stored in Cloudinary, so the app does not require a Firebase Storage bucket or Storage billing. The Firebase web API key is expected in the browser. Restrict it to the APIs this app uses and to your production domain plus `localhost` during development. Firestore rules protect user and registration data.

## Production values

These values can be set in `.env.local` as initial/fallback values:

- `VITE_PAYMENT_TELEBIRR`: the real Telebirr receiving number
- `VITE_PAYMENT_CBE`: the real CBE receiving account number

To change payment details for all devices without rebuilding the app, sign in as an admin, open the admin page from the navigation bar (or visit `/#/admin`), and save the values in **Payment account details**. The shared settings are stored in Firestore and update on users' devices in real time. The environment values are used until payment settings are first saved in the admin page.

## Language, numbered tickets, and notices

The language selector is shared across the application and remembers the selected language on each device. App pages, status messages, the administrator dashboard, and the lottery wheel provide English and Amharic text.

Ticket numbers `#001`–`#500` are reserved independently for each entry category. A selection is held for six hours from the time it is made, giving admins six hours to review the registration. The registered list hides expired unconfirmed reservations and makes their numbers available again; confirmed numbers remain listed. Existing records above `#500` are retained but excluded from new draws. Other signed-in users see names and only the last four phone digits. Full phone numbers stay in owner/admin-only reservation and receipt records.

Admins can publish bilingual notices from the admin page (`/#/admin`); signed-in users see them in the expandable **Announcements** panel at the bottom of the page.

## Draw schedule and live wheel

The home page displays the per-category schedule in Ethiopia time (`Africa/Addis_Ababa`) and switches to a live countdown during the final five days. Admins can save one schedule per category from **Draw schedule** on the admin page (`/#/admin`). After the scheduled time, only the authenticated admin can start the draw. The server freezes the approved `ticketBoard` numbers, hashes the ordered list, selects the winning number with a cryptographic random generator, and records an immutable `drawEvents` document. A second draw for that category requires a written reason and is recorded as a redraw. The live wheel listens for those events; the client animation only visualizes the already-selected result.

The wheel and draw endpoint both read approved numbers from `ticketBoard`. Receipt approval already updates that document in the same transaction as the receipt and wallet; clients can read approved board documents and cannot write draw events or draw locks. The `ticketBoard` (`tier`, `status`, `number`) and `drawEvents` (`tier`, `createdAt`) composite indexes are in `firestore.indexes.json`.

Deploy the frontend, API, Firestore rules, and indexes after changing draw behavior:

```bash
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes
```

Then redeploy the Vercel project so `/api/perform-draw`, `/api/server-time`, and the updated frontend are published together. In the admin page, choose a future Ethiopia-local date and time for each category and save it. At or after that time, use **Spin**. Further spins require at least 10 characters of written redraw reason. Check the category card on the home page or open `/#/wheel` to verify the result propagates live.

After deploying this change, deploy the Firestore rules and composite index as well as the web app:

```bash
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes
```

Number selection, receipt submission, and receipt approval use the Vercel `/api/reserve-ticket`, `/api/submit-receipt`, and `/api/approve-receipt` endpoints. Redeploy the Vercel app so all three endpoints and the frontend are updated together. The server creates ticket reservations atomically, and approval checks that the six-hour reservation is still valid before confirming the ticket and crediting the wallet.

The admin page is available at `/#/admin` (and from the navigation bar on mobile), but it does not use a client-side password. Grant the Firebase Auth user a custom claim named `admin` with the boolean value `true` using a trusted server or Firebase Admin SDK. Then sign out and back in so the refreshed ID token contains the claim. Sign-in accepts either an email address or the phone number used at registration. Firestore rules and the Vercel approval endpoint enforce the admin claim.

Admins can open **Password** from the navigation bar (or visit `/#/change-password`) to view **User password resets** above **My password**. The reset section shows pending requests in real time and lets admins search registered users by name, phone number, or ticket number. Deploy the updated Firestore rules and Vercel app for this section to work; the app redeploy also updates `/api/admin-reset-password`.

Signed-in users can change their password from the navigation bar at any time. After resetting a user's password through a trusted Firebase Admin SDK process, set `users/{uid}.mustChangePassword` to `true` and set `users/{uid}.passwordChangeRequiredAt` to a server timestamp. The app redirects that user to the change-password page after sign-in. The user must authenticate with their temporary/current password, set a new password of at least six characters, and confirm it. The authenticated Vercel endpoint clears the flag only when Firebase Auth confirms the password was updated after that timestamp. Firestore rules do not allow clients (including signed-in admins) to set or clear either password-reset field; Admin SDK writes bypass these rules.

After changing the user's password through the Admin SDK, mark the requirement with a server timestamp:

```js
await getFirestore(app).doc(`users/${uid}`).set({
  mustChangePassword: true,
  passwordChangeRequiredAt: FieldValue.serverTimestamp(),
}, { merge: true });
```

Existing flagged accounts without `passwordChangeRequiredAt` must be updated through a trusted Admin SDK process; the clearing endpoint intentionally refuses to clear them without that timestamp.

Example admin claim setup:

```js
await getAuth().setCustomUserClaims('FIREBASE_USER_UID', { admin: true });
```

Do not put service-account credentials or the custom-claim operation in the browser. Enable Email/Password authentication in Firebase Authentication and deploy Firestore rules with `firebase deploy --only firestore:rules`.

Receipt approval is handled by the Vercel endpoint at `/api/approve-receipt`. It verifies the admin claim and atomically marks the receipt approved, credits `users/{uid}.winBirrBalance`, and creates a matching `walletTransactions/{entryId}` record. The wallet transaction ID is the receipt ID, which makes retries idempotent.

## Vercel and Cloudinary

Receipt images upload directly from the browser to Cloudinary. Before each upload, `/api/cloudinary-signature` verifies the Firebase ID token and signs a unique Cloudinary public ID inside that user's `receipts/{uid}` folder. The Cloudinary API secret remains on Vercel. Create a **signed** Cloudinary upload preset that allows JPG, PNG, and WebP images and limits uploads to 5 MB.

The Vercel API reflects only same-origin requests and exact origins listed in `CORS_ALLOWED_ORIGINS`; it does not allow arbitrary origins. The Cloudinary upload endpoint supports browser uploads directly. For local Vite development against a deployed Vercel API, set `VITE_API_BASE_URL` to that Vercel deployment URL and add the exact Vite origin to `CORS_ALLOWED_ORIGINS`. Leave `VITE_API_BASE_URL` empty when the frontend and API are served from the same Vercel deployment.

Create a Telegram bot with `@BotFather`, send it one message from the chat where you want receipt notifications, and get that chat's ID. Set `TELEGRAM_ADMIN_USER_ID` to the numeric Telegram user ID that is allowed to use the Approve/Reject buttons. Set a strong `TELEGRAM_WEBHOOK_SECRET` and configure the bot's Telegram `setWebhook` URL as `https://<your-vercel-domain>/api/telegram-webhook`, with that same value as `secret_token` and `callback_query` included in `allowed_updates`. Telegram sends this token in the `X-Telegram-Bot-Api-Secret-Token` header; the webhook rejects requests without the matching token. Receipt approval from Telegram uses the same server-side transaction as the admin dashboard, including wallet credit and ticket confirmation. Rejected or approved registrations cannot be reviewed again from Telegram.

### Vercel environment variables

In Vercel Project Settings → Environment Variables, add the Firebase web app values for **Production**. Add them to Preview or Development too if those deployments are used:

```text
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_FIREBASE_MEASUREMENT_ID=your-measurement-id
```

Get these values from Firebase Console → Project settings → General → Your apps → Web app config. They are browser configuration, not service-account secrets. Vite embeds them at build time, so save them before redeploying. `VITE_FIREBASE_STORAGE_BUCKET` is not required because receipt files use Cloudinary.

For the frontend and API on the same Vercel domain, leave `VITE_API_BASE_URL` unset. Set it only when the frontend must call an API hosted on a different origin.

Add these server-only values for the environments you deploy:

```text
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
TELEGRAM_ADMIN_USER_ID=your-numeric-telegram-user-id
TELEGRAM_WEBHOOK_SECRET=your-random-telegram-webhook-secret
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

Firebase service-account credentials and the Cloudinary API secret are server-only Vercel variables. Do not put them in browser-exposed `VITE_` variables. `FIREBASE_PRIVATE_KEY` must preserve newlines or use `\\n` sequences. Telegram credentials, the admin user ID, and the webhook secret are also server-only; redeploy after adding them and configure Telegram's webhook using the same secret.
