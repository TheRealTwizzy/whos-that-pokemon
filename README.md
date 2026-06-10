# Who's That Pokemon?

Standalone browser quiz hosted on GitHub Pages. No build step is required for
the website.

Public site: https://therealtwizzy.github.io/whos-that-pokemon/

The public page includes a direct Android APK download at
`downloads/whos-that-pokemon.apk`.

## Behavior

- Loads every Pokemon generation from PokeAPI and caches the catalog locally.
- Supports optional Google login with Firebase Auth.
- Tracks a Pokedex of correct guesses locally for guests and in Firestore for
  signed-in players.
- Filters the quiz pool by type, generation, Pokedex number, or name.
- Supports quiz customization:
  - Guess mode: name, type, generation, or Pokedex number.
  - Answer style: multiple choice or typed best guess.
  - Presentation: silhouette or colored image.
  - Length: `25`, `50`, `150`, `250`, or custom from `10` to the current pool size.

## Source References

- [PokeAPI docs](https://pokeapi.co/docs/v2)
- [PokeAPI sprites repository](https://github.com/PokeAPI/sprites/)

## Firebase

The browser Firebase config is stored in `firebase-config.js`. It is public app
configuration, not a service account secret.

Required Firebase Console setup:

1. Enable Authentication > Sign-in method > Google.
2. Add `therealtwizzy.github.io` in Authentication > Settings > Authorized domains.
3. Create a Firestore database.
4. Publish the rules in `firestore.rules`.

If the Firebase CLI is installed and authenticated, deploy rules with:

```powershell
firebase deploy --only firestore:rules
```

Firestore progress documents are stored at
`pokemonQuizProfiles/{uid}`. Rules only allow a signed-in user to read and write
their own document.

## Tests

Run the pure quiz logic tests with:

```powershell
npm test
```

## Android APK

The APK is a small native Android WebView wrapper that opens the public GitHub
Pages site. It needs internet access for the app, PokeAPI data, sprites, and
Firebase auth/progress sync.

Build the signed APK locally with:

```powershell
.\tools\build-apk.ps1
```

The script writes the downloadable file to `downloads/whos-that-pokemon.apk`.
