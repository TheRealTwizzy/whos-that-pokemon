# Gen 1 Pokemon Silhouette Quiz

Standalone browser quiz. Open `index.html` directly in a browser; no build step,
package install, or local server is required.

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
