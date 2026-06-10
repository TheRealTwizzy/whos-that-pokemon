import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DATA_URL = new URL("../src/data/pokedex_data.json", import.meta.url);

const EXPECTED_GENERATION_COUNTS = new Map([
  [1, 151],
  [2, 100],
  [3, 135],
  [4, 107],
  [5, 156],
  [6, 72],
  [7, 88],
  [8, 96],
  [9, 120],
]);

async function main() {
  const path = fileURLToPath(DATA_URL);
  const data = JSON.parse(await readFile(path, "utf8"));
  const errors = validate(data);

  if (errors.length) {
    console.error(`Pokedex validation failed for ${path}`);
    for (const error of errors.slice(0, 50)) console.error(`- ${error}`);
    if (errors.length > 50) console.error(`- ...and ${errors.length - 50} more`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Validated ${data.pokemon.length} Pokedex records across ${data.generations.length} generations from ${data.source.name}.`,
  );
}

function validate(data) {
  const errors = [];
  const ids = new Set();
  const counts = new Map();

  if (data.schemaVersion !== 1) errors.push(`expected schemaVersion 1, found ${data.schemaVersion}`);
  if (data.source?.name !== "PokeAPI") errors.push("expected PokeAPI source metadata");
  if (!Array.isArray(data.generations)) errors.push("generations must be an array");
  if (!Array.isArray(data.pokemon)) errors.push("pokemon must be an array");
  if (errors.length) return errors;

  for (const generation of data.generations) {
    const expected = EXPECTED_GENERATION_COUNTS.get(Number(generation.id));
    if (!expected) errors.push(`unexpected generation ${generation.id}`);
    if (!generation.label || !generation.region) {
      errors.push(`generation ${generation.id} is missing label or region`);
    }
  }

  for (const pokemon of data.pokemon) {
    const id = Number(pokemon.id);
    if (!Number.isInteger(id) || id < 1) errors.push(`invalid id ${pokemon.id}`);
    if (ids.has(id)) errors.push(`duplicate id ${id}`);
    ids.add(id);

    const generation = Number(pokemon.generationId ?? pokemon.generation);
    counts.set(generation, (counts.get(generation) ?? 0) + 1);

    for (const field of ["name", "displayName", "generationLabel", "region", "genus", "category", "description"]) {
      if (!pokemon[field]) errors.push(`#${id} missing ${field}`);
    }

    if (!Array.isArray(pokemon.types) || pokemon.types.length < 1) errors.push(`#${id} missing types`);
    if (!Array.isArray(pokemon.abilities) || pokemon.abilities.length < 1) errors.push(`#${id} missing abilities`);
    if (!pokemon.height?.decimeters || !pokemon.height?.meters) errors.push(`#${id} missing height`);
    if (!pokemon.weight?.hectograms || !pokemon.weight?.kilograms) errors.push(`#${id} missing weight`);
    if (!pokemon.sprites?.officialArtwork && !pokemon.sprites?.frontDefault) errors.push(`#${id} missing artwork`);
  }

  for (const [generation, expected] of EXPECTED_GENERATION_COUNTS) {
    const actual = counts.get(generation) ?? 0;
    if (actual !== expected) errors.push(`generation ${generation} expected ${expected}, found ${actual}`);
  }

  const expectedTotal = [...EXPECTED_GENERATION_COUNTS.values()].reduce((sum, count) => sum + count, 0);
  if (data.pokemon.length !== expectedTotal) {
    errors.push(`expected ${expectedTotal} total records, found ${data.pokemon.length}`);
  }

  const knownEntries = [
    [1, "bulbasaur", 1],
    [25, "pikachu", 1],
    [151, "mew", 1],
    [251, "celebi", 2],
    [493, "arceus", 4],
    [649, "genesect", 5],
    [721, "volcanion", 6],
    [809, "melmetal", 7],
    [905, "enamorus", 8],
    [1025, "pecharunt", 9],
  ];

  for (const [id, name, generation] of knownEntries) {
    const pokemon = data.pokemon.find((entry) => entry.id === id);
    if (!pokemon) {
      errors.push(`missing expected #${id} ${name}`);
      continue;
    }
    if (pokemon.name !== name) errors.push(`#${id} expected ${name}, found ${pokemon.name}`);
    if (pokemon.generationId !== generation) {
      errors.push(`#${id} expected generation ${generation}, found ${pokemon.generationId}`);
    }
  }

  return errors;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
