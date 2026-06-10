import { formatGenerationLabel, formatPokemonName, STANDARD_TYPES } from "./core.mjs";

const API_BASE = "https://pokeapi.co/api/v2";
const CACHE_KEY = "pokemonQuiz.catalog.v2";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function loadPokemonCatalog({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = readCatalogCache();
    if (cached) return cached;
  }

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
  writeCatalogCache(catalog);
  return catalog;
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
