import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "https://pokeapi.co/api/v2";
const MAX_GENERATION = 9;
const CONCURRENCY = 24;
const OUTPUT_URL = new URL("../src/data/pokedex_data.json", import.meta.url);

const GENERATION_ROMANS = new Map([
  [1, "I"],
  [2, "II"],
  [3, "III"],
  [4, "IV"],
  [5, "V"],
  [6, "VI"],
  [7, "VII"],
  [8, "VIII"],
  [9, "IX"],
]);

const TYPE_ORDER = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
];

async function main() {
  const generationIndex = await fetchJson(`${API_BASE}/generation?limit=100`);
  const generationResources = await mapLimit(generationIndex.results, 4, (entry) => fetchJson(entry.url));
  const generations = generationResources
    .map(toGenerationRecord)
    .filter((generation) => generation.id >= 1 && generation.id <= MAX_GENERATION)
    .sort((left, right) => left.id - right.id);

  const generationBySpeciesId = new Map();
  for (const generation of generations) {
    for (const speciesId of generation.pokemonSpeciesIds) {
      generationBySpeciesId.set(speciesId, generation);
    }
  }

  const speciesIds = [...generationBySpeciesId.keys()].sort((left, right) => left - right);
  const speciesResources = await mapLimit(speciesIds, CONCURRENCY, (id) =>
    fetchJson(`${API_BASE}/pokemon-species/${id}`),
  );
  const pokemonResources = await mapLimit(speciesResources, CONCURRENCY, fetchPokemonForSpecies);

  const pokemon = speciesResources
    .map((species, index) => toPokemonRecord(species, pokemonResources[index], generationBySpeciesId.get(species.id)))
    .sort((left, right) => left.id - right.id);

  const dataset = {
    schemaVersion: 1,
    source: {
      name: "PokeAPI",
      apiBase: API_BASE,
      docs: "https://pokeapi.co/docs/v2",
      generatedAt: new Date().toISOString(),
      generator: "scripts/build-pokedex-data.mjs",
    },
    generations: generations.map((generation) => ({
      id: generation.id,
      name: generation.name,
      label: generation.label,
      region: generation.region,
      pokemonSpeciesIds: generation.pokemonSpeciesIds,
    })),
    types: TYPE_ORDER,
    pokemon,
    metadata: {
      maxGeneration: MAX_GENERATION,
      recordCount: pokemon.length,
    },
  };

  validateDataset(dataset);

  const outputPath = fileURLToPath(OUTPUT_URL);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${toAsciiJson(dataset)}\n`, "utf8");

  console.log(
    `Wrote ${pokemon.length} Gen 1-${MAX_GENERATION} Pokedex records to ${outputPath}`,
  );
}

async function fetchPokemonForSpecies(species) {
  try {
    return await fetchJson(`${API_BASE}/pokemon/${species.id}`);
  } catch (error) {
    const defaultVariety = species.varieties?.find((variety) => variety.is_default)?.pokemon;
    if (!defaultVariety?.url) throw error;
    return fetchJson(defaultVariety.url);
  }
}

function toGenerationRecord(resource) {
  const id = Number(resource.id);
  const pokemonSpeciesIds = resource.pokemon_species
    .map((species) => idFromUrl(species.url))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  return {
    id,
    name: resource.name,
    label: `Generation ${GENERATION_ROMANS.get(id) ?? id}`,
    region: resource.main_region?.name ?? "",
    pokemonSpeciesIds,
  };
}

function toPokemonRecord(species, pokemon, generation) {
  const genus = englishGenus(species.genera);
  const flavor = englishFlavorText(species.flavor_text_entries);
  const officialArtwork = pokemon.sprites?.other?.["official-artwork"]?.front_default ?? null;
  const homeArtwork = pokemon.sprites?.other?.home?.front_default ?? null;

  return {
    id: Number(species.id),
    name: species.name,
    displayName: englishName(species.names, species.name),
    generation: generation.id,
    generationId: generation.id,
    generationLabel: generation.label,
    region: generation.region,
    types: pokemon.types
      .sort((left, right) => left.slot - right.slot)
      .map((entry) => entry.type.name),
    height: {
      decimeters: Number(pokemon.height),
      meters: Number((Number(pokemon.height) / 10).toFixed(1)),
    },
    weight: {
      hectograms: Number(pokemon.weight),
      kilograms: Number((Number(pokemon.weight) / 10).toFixed(1)),
    },
    genus,
    category: categoryFromGenus(genus),
    description: flavor.text,
    flavorText: flavor.text,
    flavorVersion: flavor.version,
    abilities: pokemon.abilities
      .sort((left, right) => left.slot - right.slot)
      .map((entry) => ({
        name: entry.ability.name,
        displayName: titleCaseSlug(entry.ability.name),
        isHidden: Boolean(entry.is_hidden),
        slot: Number(entry.slot),
      })),
    spriteUrl: officialArtwork ?? homeArtwork ?? pokemon.sprites?.front_default ?? null,
    artworkUrl: officialArtwork,
    sprites: {
      frontDefault: pokemon.sprites?.front_default ?? null,
      frontShiny: pokemon.sprites?.front_shiny ?? null,
      officialArtwork,
      officialArtworkShiny: pokemon.sprites?.other?.["official-artwork"]?.front_shiny ?? null,
      home: homeArtwork,
      homeShiny: pokemon.sprites?.other?.home?.front_shiny ?? null,
    },
    source: {
      speciesUrl: `${API_BASE}/pokemon-species/${species.id}/`,
      pokemonUrl: `${API_BASE}/pokemon/${pokemon.id}/`,
    },
  };
}

function englishName(names, fallback) {
  return names?.find((entry) => entry.language.name === "en")?.name ?? titleCaseSlug(fallback);
}

function englishGenus(genera) {
  return genera?.find((entry) => entry.language.name === "en")?.genus ?? "";
}

function englishFlavorText(entries) {
  const englishEntries = entries
    .filter((entry) => entry.language.name === "en")
    .map((entry) => ({
      text: cleanFlavorText(entry.flavor_text),
      version: entry.version.name,
      versionId: idFromUrl(entry.version.url),
    }))
    .filter((entry) => entry.text)
    .sort((left, right) => right.versionId - left.versionId);

  return englishEntries[0] ?? { text: "", version: "" };
}

function cleanFlavorText(value) {
  return String(value ?? "")
    .replace(/[\f\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryFromGenus(genus) {
  return genus.replace(/\s+Pok(?:e|\u00e9)mon$/iu, "");
}

function titleCaseSlug(value) {
  return String(value)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function validateDataset(dataset) {
  const errors = [];
  const ids = new Set();

  if (dataset.generations.length !== MAX_GENERATION) {
    errors.push(`expected ${MAX_GENERATION} generations, found ${dataset.generations.length}`);
  }

  for (const pokemon of dataset.pokemon) {
    if (ids.has(pokemon.id)) errors.push(`duplicate pokemon id ${pokemon.id}`);
    ids.add(pokemon.id);
    if (pokemon.generation < 1 || pokemon.generation > MAX_GENERATION) {
      errors.push(`#${pokemon.id} has invalid generation ${pokemon.generation}`);
    }
    if (!pokemon.name || !pokemon.displayName) errors.push(`#${pokemon.id} is missing a name`);
    if (!pokemon.types.length) errors.push(`#${pokemon.id} is missing types`);
    if (!pokemon.genus) errors.push(`#${pokemon.id} is missing genus`);
    if (!pokemon.description) errors.push(`#${pokemon.id} is missing description`);
    if (!pokemon.abilities.length) errors.push(`#${pokemon.id} is missing abilities`);
    if (!pokemon.spriteUrl) errors.push(`#${pokemon.id} is missing spriteUrl`);
  }

  for (const id of [1, 25, 150, 251, 493, 649, 721, 809, 905, 1025]) {
    if (!ids.has(id)) errors.push(`expected National Dex #${id}`);
  }

  if (errors.length) {
    throw new Error(`Pokedex data validation failed:\n${errors.slice(0, 20).join("\n")}`);
  }
}

async function mapLimit(values, limit, worker) {
  const output = Array.from({ length: values.length });
  let cursor = 0;

  async function run() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return output;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "whos-that-pokemon-data-generator/1.0",
    },
  });
  if (!response.ok) throw new Error(`PokeAPI request failed: ${response.status} ${url}`);
  return response.json();
}

function idFromUrl(url) {
  const match = String(url).match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : NaN;
}

function toAsciiJson(value) {
  return JSON.stringify(value, null, 2).replace(/[^\x00-\x7F]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
