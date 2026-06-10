import { formatGenerationLabel, formatPokemonName, STANDARD_TYPES } from "./core.mjs";

const API_BASE = "https://pokeapi.co/api/v2";
const BUNDLED_POKEDEX_URL = new URL("./data/pokedex_data.json", import.meta.url);
const CACHE_KEY = "pokemonQuiz.catalog.v3";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function loadPokemonCatalog({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = readCatalogCache();
    if (cached) return cached;
  }

  try {
    const catalog = await loadBundledCatalog({ cacheBust: forceRefresh });
    writeCatalogCache(catalog);
    return catalog;
  } catch {
    // The static Pokedex is the preferred path. Live PokeAPI remains a fallback
    // for local file previews or stale deployments missing the generated JSON.
  }

  const catalog = await loadLiveCatalog();
  writeCatalogCache(catalog);
  return catalog;
}

export async function loadPokedexData({ cacheBust = false } = {}) {
  const url = new URL(BUNDLED_POKEDEX_URL);
  if (cacheBust) url.searchParams.set("t", String(Date.now()));
  return fetchJson(url.href);
}

export function normalizePokedexData(data) {
  if (!data || !Array.isArray(data.pokemon)) {
    throw new Error("Bundled Pokedex data is missing a pokemon array.");
  }

  const generations = normalizeGenerations(data);
  const pokemon = data.pokemon
    .map((entry) => {
      const id = Number(entry.id ?? entry.nationalDexNumber);
      const name = entry.name ?? entry.slug ?? slugify(entry.species ?? entry.displayName ?? id);
      const generationId = Number(
        entry.generationId ?? entry.generation ?? generationIdFromLabel(entry.generationLabel),
      ) || 0;
      const description = entry.description ?? entry.flavorText ?? entry.pokedexEntry ?? "";
      return {
        id,
        name,
        displayName: entry.displayName ?? entry.species ?? formatPokemonName(name),
        generationId,
        generation: generationId,
        generationLabel: entry.generationLabel ?? formatGenerationLabel(generationId),
        region: entry.region ?? regionFromGenerationId(generationId),
        types: normalizeTypes(entry),
        height: entry.height ?? normalizeHeight(entry.heightM),
        weight: entry.weight ?? normalizeWeight(entry.weightKg),
        genus: entry.genus ?? "",
        category: entry.category ?? "",
        description,
        flavorText: entry.flavorText ?? description,
        pokedexEntry: entry.pokedexEntry ?? description,
        flavorVersion: entry.flavorVersion ?? "",
        abilities: Array.isArray(entry.abilities) ? entry.abilities : [],
        spriteUrl: entry.spriteUrl ?? entry.artwork ?? entry.sprites?.officialArtwork ?? entry.sprites?.frontDefault ?? "",
        artworkUrl: entry.artworkUrl ?? entry.artwork ?? entry.sprites?.officialArtwork ?? "",
        sprites: entry.sprites ?? {},
        source: entry.source ?? null,
      };
    })
    .filter((pokemon) => Number.isFinite(pokemon.id))
    .sort((left, right) => left.id - right.id);

  return {
    schemaVersion: data.schemaVersion ?? 0,
    source: data.source ?? null,
    pokemon,
    generations,
    types: Array.isArray(data.types) ? data.types : STANDARD_TYPES,
    loadedAt: Date.now(),
  };
}

export { normalizePokedexData as normalizeStaticCatalog };

async function loadBundledCatalog({ cacheBust = false } = {}) {
  const data = await loadPokedexData({ cacheBust });
  return normalizePokedexData(data);
}

async function loadLiveCatalog() {
  const [speciesIndex, generationIndex] = await Promise.all([
    fetchJson(`${API_BASE}/pokemon-species?limit=2000`),
    fetchJson(`${API_BASE}/generation?limit=100`),
  ]);

  const generations = await loadGenerations(generationIndex.results);
  const generationBySpecies = new Map();
  for (const generation of generations) {
    for (const speciesName of generation.speciesNames) {
      generationBySpecies.set(speciesName, generation);
    }
  }

  const species = speciesIndex.results
    .map((entry) => {
      const id = idFromUrl(entry.url);
      const generation = generationBySpecies.get(entry.name);
      return {
        id,
        name: entry.name,
        displayName: formatPokemonName(entry.name),
        generationId: generation?.id ?? 0,
        generationLabel: generation?.label ?? "Unknown Generation",
        region: generation?.region ?? "",
        types: [],
      };
    })
    .filter((pokemon) => Number.isFinite(pokemon.id))
    .sort((left, right) => left.id - right.id);

  const typesBySpecies = await loadTypesBySpecies(species);
  const pokemon = species.map((entry) => ({
    ...entry,
    types: [...(typesBySpecies.get(entry.name) ?? [])].sort(),
  }));

  const catalog = {
    pokemon,
    generations: generations.map(({ speciesNames, ...generation }) => generation),
    types: STANDARD_TYPES,
    loadedAt: Date.now(),
  };
  return catalog;
}

function normalizeGenerations(data) {
  if (!Array.isArray(data.generations)) return [];
  return data.generations
    .map((entry) => ({
      id: Number(entry.id),
      name: entry.name,
      label: entry.label ?? formatGenerationLabel(entry.id, entry.name),
      region: entry.region ?? "",
      pokemonSpeciesIds: Array.isArray(entry.pokemonSpeciesIds) ? entry.pokemonSpeciesIds : [],
    }))
    .filter((generation) => Number.isFinite(generation.id))
    .sort((left, right) => left.id - right.id);
}

function normalizeTypes(entry) {
  const types = Array.isArray(entry.types)
    ? entry.types
    : [entry.type1, entry.type2].filter(Boolean);

  return types.map((type) => String(type).toLowerCase());
}

function normalizeHeight(heightM) {
  if (!heightM) return null;
  const meters = Number(heightM);
  return {
    decimeters: Number((meters * 10).toFixed(1)),
    meters,
  };
}

function normalizeWeight(weightKg) {
  if (!weightKg) return null;
  const kilograms = Number(weightKg);
  return {
    hectograms: Number((kilograms * 10).toFixed(1)),
    kilograms,
  };
}

function generationIdFromLabel(label) {
  const value = String(label ?? "").toLowerCase();
  if (!value) return 0;
  const direct = value.match(/\b([1-9])\b/);
  if (direct) return Number(direct[1]);

  const romans = new Map([
    ["i", 1],
    ["ii", 2],
    ["iii", 3],
    ["iv", 4],
    ["v", 5],
    ["vi", 6],
    ["vii", 7],
    ["viii", 8],
    ["ix", 9],
  ]);
  return romans.get(value.split(/\s+/).at(-1)) ?? 0;
}

function regionFromGenerationId(generationId) {
  return new Map([
    [1, "kanto"],
    [2, "johto"],
    [3, "hoenn"],
    [4, "sinnoh"],
    [5, "unova"],
    [6, "kalos"],
    [7, "alola"],
    [8, "galar"],
    [9, "paldea"],
  ]).get(generationId) ?? "";
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function loadGenerations(entries) {
  const resources = await Promise.all(entries.map((entry) => fetchJson(entry.url)));
  return resources
    .map((resource) => {
      const id = idFromResource(resource);
      return {
        id,
        name: resource.name,
        label: formatGenerationLabel(id, resource.name),
        region: resource.main_region?.name ?? "",
        speciesNames: resource.pokemon_species.map((species) => species.name),
      };
    })
    .filter((generation) => Number.isFinite(generation.id))
    .sort((left, right) => left.id - right.id);
}

async function loadTypesBySpecies(species) {
  const speciesNames = species.map((pokemon) => pokemon.name);
  const speciesNameSet = new Set(speciesNames);
  const sortedSpeciesNames = [...speciesNames].sort((left, right) => right.length - left.length);
  const exactTypes = new Map();
  const fallbackTypes = new Map();

  await Promise.all(
    STANDARD_TYPES.map(async (type) => {
      const resource = await fetchJson(`${API_BASE}/type/${type}`);
      for (const item of resource.pokemon) {
        const pokemonName = item.pokemon.name;
        if (speciesNameSet.has(pokemonName)) {
          addType(exactTypes, pokemonName, type);
          continue;
        }

        const speciesName = findSpeciesNameForPokemon(pokemonName, sortedSpeciesNames);
        if (speciesName) addType(fallbackTypes, speciesName, type);
      }
    }),
  );

  const output = new Map();
  for (const name of speciesNames) {
    const exact = exactTypes.get(name);
    output.set(name, exact?.size ? exact : (fallbackTypes.get(name) ?? new Set()));
  }
  return output;
}

function addType(map, speciesName, type) {
  if (!map.has(speciesName)) map.set(speciesName, new Set());
  map.get(speciesName).add(type);
}

function findSpeciesNameForPokemon(pokemonName, sortedSpeciesNames) {
  return sortedSpeciesNames.find((speciesName) => pokemonName.startsWith(`${speciesName}-`));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PokeAPI request failed: ${response.status} ${url}`);
  return response.json();
}

export function idFromResource(resource) {
  return Number(resource?.id) || idFromUrl(resource?.url);
}

function idFromUrl(url) {
  const match = String(url).match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : NaN;
}

function readCatalogCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.loadedAt || Date.now() - parsed.loadedAt > CACHE_MAX_AGE_MS) return null;
    if (!Array.isArray(parsed.pokemon) || !Array.isArray(parsed.generations)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCatalogCache(catalog) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
  } catch {
    // Storage may be blocked or full; the app still works without cache.
  }
}
