# NO-LOST-WIN
IT IS FOR A GOOD FROM A GOOD WILL 

## Firebase setup

Copy `.env.example` to `.env.local` and replace every Firebase placeholder with the web app configuration from Firebase Console. Do not commit `.env.local`; it contains environment-specific settings.

The Firebase web API key is expected to be present in the browser. In Google Cloud Console, restrict it to the APIs this app uses and to your production domain plus `localhost` during development. This protects the key from unrelated use; Firestore and Storage rules protect the data.
