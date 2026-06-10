# Gen 1 Pokemon Silhouette Quiz

Standalone browser quiz. Open `index.html` directly in a browser; no build step,
package install, or local server is required.

Public site: https://therealtwizzy.github.io/whos-that-pokemon/

The public page includes a direct Android APK download at
`downloads/whos-that-pokemon.apk`.

## Behavior

- Uses only original Gen 1 Pokemon, IDs `1-151`.
- Lets the player choose quiz length: `10`, `25`, `50`, or `151`.
- Shows official-artwork sprites from the PokeAPI sprites repository as black
  silhouettes until a correct guess or reveal.
- Accepts case-insensitive answers, punctuation variants, common aliases, and
  moderate typos while avoiding fuzzy matches against exact names of other Gen 1
  Pokemon.

## Source References

- [PokeAPI docs](https://pokeapi.co/docs/v2)
- [PokeAPI sprites repository](https://github.com/PokeAPI/sprites/)

## Android APK

The APK is a small native Android WebView wrapper that packages the same
`index.html` as a local asset. The app still needs internet access for Pokemon
artwork because the sprites are loaded from the PokeAPI sprites repository.

Build the signed APK locally with:

```powershell
.\tools\build-apk.ps1
```

The script writes the downloadable file to `downloads/whos-that-pokemon.apk`.
