# Who's That Pokémon?

Standalone browser quiz hosted on GitHub Pages. No build step is required for
the website.

Public site: https://therealtwizzy.github.io/whos-that-pokemon/

The public page includes a direct Android APK download at
`downloads/whos-that-pokemon.apk`. Mobile browsers can also install the
standalone web app from the PokéOS install control; on iOS this is the supported
Home Screen app path.

## Behavior

- Loads every Pokémon generation from PokéAPI and caches the catalog locally.
- Supports optional Google login with Firebase Auth.
- Supports local Trainer profiles for APK-safe play without Google sign-in.
- Auto-boots into a physical PokéDex shell running PokéOS, then requires OS
  login through Guest, Local Account, or Google before apps are available.
- The hardware shell keeps visible text outside the LCD to the PokéDex name.
  Active account/session details live inside PokéOS.
- PokéOS uses nostalgic Pokémon Red/Blue/Yellow-style menu boxes, cursor
  navigation, low-color LCD panels, and hard-bordered command lists.
- The PokéDex body is visual shell hardware, not emulated D-pad, button, stylus,
  or keyboard controls. Players use the LCD controls directly with touch or
  mouse, and the device keyboard is used for text input and accessibility
  shortcuts without adding extra UI.
- LCD Pokémon prompts and log thumbnails prefer pixel sprite URLs, with modern
  artwork retained only as a fallback when a sprite is unavailable.
- PokéOS maps the local Red/Blue SFX library to boot/login, menu movement,
  app launch, scanner actions, answers, quiz completion, and session lock, with
  generated speaker cues as a fallback when samples are unavailable.
- After login, PokéOS opens to a pause-menu-style command window for Quiz,
  PokéDex, Ranking, and Option, rather than a separate Home app.
- When no command is open, an idle PokéOS splash fills the LCD behind the
  command window. Selecting a command hides the menu, swaps in an app-specific
  LCD splash icon, then opens that app full-screen inside the LCD.
- PokéOS includes an LCD-only display mode that hides the hardware shell and
  fills the device viewport with the LCD surface.
- The physical PokéDex shell scales to fit the player viewport, and the emulated
  LCD surface does not scroll; long app lists can scroll inside their own
  command windows.
- Mobile and installed-app portrait viewports auto-rotate the PokéDex display
  to the nearest landscape angle instead of blocking play with a rotation
  splash screen.
- Tracks a PokéDex of correct guesses locally for guests and local Trainers,
  and in Firestore for signed-in Google players.
- Runs the quiz as the "Who's That Pokémon?" PokéOS app.
- Quiz setup is limited to generation, question count, answer style, timed mode,
  and leaderboard intent.
- Silhouette presentation and Pokémon-name guessing are always enabled.
- During a quiz, holding the small art button swaps only the current silhouette
  source between pixel sprite and official artwork.
- Question presets are `25`, `50`, `100`, and `Entire Generation` for single
  generations. `All Pokémon` is available only when the generation is `All`.
- `All Pokémon` timed runs are personal-best only and do not submit to public
  leaderboards.
- Typed runs show a minimal autofill row below the input. It supports alphabetic
  matches and conservative spelling correction, but caps suggestions so the LCD
  is not overwhelmed. Selecting a suggestion fills the input only; the player
  must still press `Guess`.
- Each question allows three non-empty attempts. Correct answers reveal the
  Pokémon and pause the stopwatch during the reveal. Timed, clean runs stage the
  PokéDex entry; untimed casual runs never update the PokéDex log, even after
  correct guesses. Three misses leave the Pokémon unrevealed and unlogged.
- Leaving or minimizing the active tab/app, pasting an answer, or dropping text
  into the answer input immediately rejects the active quiz, closes the active
  session, discards staged results, and returns to the lock screen.
- Untimed casual runs do not save timed bests or public leaderboard scores.
  Timed runs save personal bests. Public leaderboard submission additionally
  requires Google Auth, `Timed`, `Leaderboard`, a public-eligible preset, and a
  clean completed run.

Local Trainer profiles are local save slots on the current browser or installed
APK. They are not password-protected accounts. Each profile keeps its own local
PokéDex progress, timed personal bests, partner avatar, device shell theme, and
saved quiz defaults. Device shell themes recolor the PokéDex hardware shell;
PokéOS keeps its fixed game-screen palette. Guest mode remains a temporary local
session.

Pokémon and related intellectual property belong to their respective owners. The
in-app Options screen carries the rights notice:
`©2026 Pokémon. ©1995-2026 Nintendo/Creatures Inc./GAME FREAK inc. Pokémon and Pokémon character names are trademarks of Nintendo.`

## Source References

- [PokéAPI docs](https://pokeapi.co/docs/v2)
- [PokéAPI sprites repository](https://github.com/PokeAPI/sprites/)

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

Firestore progress documents are stored at `pokemonQuizProfiles/{uid}`. Personal
timed scores are stored under each profile. Public leaderboard scores are stored
under `leaderboards/{boardKey}/scores/{uid}` and are readable by anyone.

Redesigned timed score keys use the v2 shape:

```text
v2|gen:{all-or-generation-id}|q:{25|50|100|entire-generation|all-pokemon}|total:{resolved-total}|answer:{typed|choice}|device:{keyboard|touch}
```

Rules require Google sign-in, score ownership, v2 score shape, and matching
document paths. Public leaderboard writes also require a public-eligible v2
question preset and reject `All Pokémon` public submissions. Timed boards are
also separated by automatic input device class so mouse/keyboard and mobile
touch runs do not share public or personal-best categories. Category integrity is
primarily resolved by the client setup policy before score submission.

Google OAuth is blocked by Google inside embedded Android WebViews. The APK
therefore treats Google Auth as unavailable and keeps Guest/local Trainer play
usable. Native Android Google login is a future milestone; it should use a
platform-supported auth flow instead of WebView OAuth.

## Tests

Run the pure quiz logic tests with:

```powershell
npm test
```

## Android APK

The APK is a small native Android WebView wrapper that opens the public GitHub
Pages site. It needs internet access for the app, PokéAPI data, and sprites.
The WebView APK uses Guest or local Trainer profiles for progress today.
Firebase/Google progress sync is available in supported browsers until native
Android Google login is implemented as a separate milestone.

Build the signed APK locally with:

```powershell
.\tools\build-apk.ps1
```

The script writes the downloadable file to `downloads/whos-that-pokemon.apk`.
