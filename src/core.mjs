export const STANDARD_TYPES = [
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

const PUBLIC_LEADERBOARD_LENGTHS = new Set([25, 50, 150, 250]);

const NAME_EXCEPTIONS = new Map([
  ["farfetchd", "Farfetch'd"],
  ["sirfetchd", "Sirfetch'd"],
  ["mr-mime", "Mr. Mime"],
  ["mime-jr", "Mime Jr."],
  ["nidoran-f", "Nidoran♀"],
  ["nidoran-m", "Nidoran♂"],
  ["ho-oh", "Ho-Oh"],
  ["porygon-z", "Porygon-Z"],
  ["type-null", "Type: Null"],
  ["jangmo-o", "Jangmo-o"],
  ["hakamo-o", "Hakamo-o"],
  ["kommo-o", "Kommo-o"],
  ["flabebe", "Flabebe"],
]);

const GENERATION_ROMANS = new Map([
  [1, "i"],
  [2, "ii"],
  [3, "iii"],
  [4, "iv"],
  [5, "v"],
  [6, "vi"],
  [7, "vii"],
  [8, "viii"],
  [9, "ix"],
  [10, "x"],
]);

const GENERATION_REGIONS = new Map([
  [1, "kanto"],
  [2, "johto"],
  [3, "hoenn"],
  [4, "sinnoh"],
  [5, "unova"],
  [6, "kalos"],
  [7, "alola"],
  [8, "galar"],
  [9, "paldea"],
]);

const GENERATION_DEX_RANGES = [
  [1, 1, 151],
  [2, 152, 251],
  [3, 252, 386],
  [4, 387, 493],
  [5, 494, 649],
  [6, 650, 721],
  [7, 722, 809],
  [8, 810, 905],
  [9, 906, 1025],
];

export function formatPokemonName(name) {
  if (NAME_EXCEPTIONS.has(name)) return NAME_EXCEPTIONS.get(name);

  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

export function formatGenerationLabel(id, apiName = "") {
  const roman = GENERATION_ROMANS.get(Number(id));
  if (roman) return `Generation ${roman.toUpperCase()}`;
  if (apiName) return apiName.split("-").map(capitalize).join(" ");
  return `Generation ${id}`;
}

export function normalizePokedexCatalog(rawCatalog, { loadedAt = Date.now(), source = "pokedex_data.json" } = {}) {
  const rawPokemon = Array.isArray(rawCatalog)
    ? rawCatalog
    : rawCatalog?.pokemon ?? rawCatalog?.entries ?? [];

  if (!Array.isArray(rawPokemon)) {
    throw new Error("PokeDex data must provide a pokemon or entries array.");
  }

  const generationOverrides = readGenerationOverrides(rawCatalog?.generations);
  const pokemon = rawPokemon
    .map((entry) => normalizePokedexPokemon(entry, generationOverrides))
    .filter(Boolean)
    .sort((left, right) => left.id - right.id);
  const generationIds = [...new Set(pokemon.map((entry) => entry.generationId).filter(Boolean))]
    .sort((left, right) => left - right);
  const generations = generationIds.map((id) => ({
    id,
    name: generationOverrides.get(id)?.name ?? `generation-${GENERATION_ROMANS.get(id) ?? id}`,
    label: generationOverrides.get(id)?.label ?? formatGenerationLabel(id),
    region: generationOverrides.get(id)?.region ?? GENERATION_REGIONS.get(id) ?? "",
  }));
  const catalogTypes = Array.isArray(rawCatalog?.types)
    ? rawCatalog.types.map((type) => cleanType(type)).filter(Boolean)
    : STANDARD_TYPES;

  return {
    pokemon,
    generations,
    types: [...new Set(catalogTypes)],
    loadedAt,
    source,
  };
}

export function normalizeAnswer(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("♀", " female ")
    .replaceAll("♂", " male ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function buildQuizPool(pokemon, filters) {
  const type = filters.type && filters.type !== "all" ? filters.type : "";
  const generation = filters.generation && filters.generation !== "all"
    ? Number(filters.generation)
    : null;
  const search = String(filters.search ?? "").trim();
  const normalizedSearch = normalizeAnswer(search);

  return pokemon.filter((candidate) => {
    if (type && !candidate.types.includes(type)) return false;
    if (generation && candidate.generationId !== generation) return false;

    if (!normalizedSearch) return true;
    const idText = String(candidate.id);
    const paddedId = idText.padStart(3, "0");
    const names = [candidate.name, candidate.displayName, ...getNameAliases(candidate)];

    return (
      idText.includes(search) ||
      paddedId.includes(search) ||
      names.some((name) => normalizeAnswer(name).includes(normalizedSearch))
    );
  });
}

export function getLengthCap({ mode, preset, custom, poolSize }) {
  if (poolSize <= 0) return 0;
  const requested = mode === "custom"
    ? clamp(Number(custom) || 10, 10, poolSize)
    : Number(preset) || 25;

  return clamp(requested, 1, poolSize);
}

export function formatElapsedTime(ms) {
  const totalTenths = Math.max(0, Math.floor(Number(ms) / 100) || 0);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export function buildLeaderboardKey(settings) {
  const length = Number(settings.length) || 0;
  const guessMode = cleanKeyPart(settings.guessMode || "name");
  const answerStyle = cleanKeyPart(settings.answerStyle || "input");
  const presentation = cleanKeyPart(settings.presentation || "silhouette");
  const type = cleanKeyPart(settings.type || "all");
  const generation = cleanKeyPart(settings.generation || "all");
  const search = cleanKeyPart(settings.search || "");

  return [
    "v1",
    `len:${length}`,
    `guess:${guessMode}`,
    `style:${answerStyle}`,
    `present:${presentation}`,
    `type:${type}`,
    `gen:${generation}`,
    `search:${search}`,
  ].join("|");
}

export function isLeaderboardEligible(settings, user) {
  return Boolean(
    user?.uid &&
    user?.provider === "google" &&
    settings?.timed &&
    settings.lengthMode === "preset" &&
    PUBLIC_LEADERBOARD_LENGTHS.has(Number(settings.length)),
  );
}

export function isBetterScore(next, current) {
  if (!next) return false;
  if (!current) return true;
  if (Number(next.correct) !== Number(current.correct)) {
    return Number(next.correct) > Number(current.correct);
  }
  return Number(next.elapsedMs) < Number(current.elapsedMs);
}

export function getAccessGate(progress) {
  if (!progress?.authReady) {
    return {
      locked: true,
      method: "loading",
      label: "Loading trainer access...",
    };
  }

  if (progress?.user?.uid) {
    return {
      locked: false,
      method: "google",
      label: "Google trainer access granted.",
    };
  }

  const method = progress?.access?.method;
  if (method === "guest" || method === "registered") {
    return {
      locked: false,
      method,
      label: method === "guest" ? "Guest trainer access granted." : "Registered trainer access granted.",
    };
  }

  return {
    locked: true,
    method: "locked",
    label: "PokeDex locked. Choose Guest, Register, or Google.",
  };
}

export function isCorrectAnswer(input, pokemon, mode, allPokemon = []) {
  if (mode === "type") return matchesType(input, pokemon);
  if (mode === "generation") return matchesGeneration(input, pokemon);
  if (mode === "number") return matchesNumber(input, pokemon);
  return matchesName(input, pokemon, allPokemon);
}

export function buildChoices({
  current,
  pool,
  mode,
  allTypes,
  generations,
  random = Math.random,
}) {
  const correct = getChoiceForPokemon(current, mode, generations);
  const correctValues = getCorrectChoiceValues(current, mode);
  const source = getChoiceSource({ current, pool, mode, allTypes, generations });
  const shuffled = shuffle(source, random);
  const options = [correct];

  for (const option of shuffled) {
    if (options.length >= 4) break;
    if (correctValues.includes(option.value)) continue;
    if (options.some((existing) => existing.value === option.value)) continue;
    options.push({ ...option, correct: false });
  }

  return shuffle(options, random);
}

function getCorrectChoiceValues(pokemon, mode) {
  if (mode === "type") return pokemon.types;
  if (mode === "generation") return [String(pokemon.generationId)];
  if (mode === "number") return [String(pokemon.id)];
  return [pokemon.displayName];
}

export function mergeIdSets(...sets) {
  return [...new Set(sets.flat().map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

export function shuffle(values, random = Math.random) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

export function getSpriteUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

export function getNameAliases(pokemon) {
  const aliases = new Set([pokemon.name, pokemon.displayName]);
  if (pokemon.name === "mr-mime") aliases.add("mr mime");
  if (pokemon.name === "mime-jr") aliases.add("mime jr");
  if (pokemon.name === "farfetchd") aliases.add("farfetchd");
  if (pokemon.name === "sirfetchd") aliases.add("sirfetchd");
  if (pokemon.name === "nidoran-f") {
    aliases.add("nidoran female");
    aliases.add("nidoran f");
  }
  if (pokemon.name === "nidoran-m") {
    aliases.add("nidoran male");
    aliases.add("nidoran m");
  }

  return [...aliases];
}

function matchesName(input, pokemon, allPokemon) {
  const normalizedInput = normalizeAnswer(input);
  if (!normalizedInput) return false;

  const answers = getNameAliases(pokemon).map(normalizeAnswer);
  if (answers.includes(normalizedInput)) return true;

  const exactOwner = allPokemon.find((candidate) =>
    getNameAliases(candidate).some((alias) => normalizeAnswer(alias) === normalizedInput),
  );
  if (exactOwner && exactOwner.id !== pokemon.id) return false;

  return answers.some((answer) => {
    const allowance = typoAllowance(answer.length);
    return allowance > 0 && levenshtein(normalizedInput, answer) <= allowance;
  });
}

function matchesType(input, pokemon) {
  const normalizedInput = normalizeAnswer(input);
  return pokemon.types.some((type) => normalizeAnswer(type) === normalizedInput);
}

function matchesGeneration(input, pokemon) {
  const normalizedInput = normalizeAnswer(input);
  const roman = GENERATION_ROMANS.get(pokemon.generationId);
  const allowed = [
    pokemon.generationId,
    `gen ${pokemon.generationId}`,
    `generation ${pokemon.generationId}`,
    pokemon.generationLabel,
    pokemon.region,
  ];
  if (roman) {
    allowed.push(roman, `gen ${roman}`, `generation ${roman}`);
  }

  return allowed.some((value) => normalizeAnswer(value) === normalizedInput);
}

function matchesNumber(input, pokemon) {
  const digits = String(input ?? "").replace(/\D/g, "");
  return Boolean(digits) && Number(digits) === pokemon.id;
}

function getChoiceForPokemon(pokemon, mode, generations) {
  if (mode === "type") {
    const value = pokemon.types[0] ?? "unknown";
    return { label: capitalize(value), value, correct: true };
  }
  if (mode === "generation") {
    const generation = generations.find((candidate) => candidate.id === pokemon.generationId);
    const label = generation?.label ?? pokemon.generationLabel;
    return { label, value: String(pokemon.generationId), correct: true };
  }
  if (mode === "number") {
    return { label: `#${String(pokemon.id).padStart(3, "0")}`, value: String(pokemon.id), correct: true };
  }
  return { label: pokemon.displayName, value: pokemon.displayName, correct: true };
}

function getChoiceSource({ current, pool, mode, allTypes, generations }) {
  if (mode === "type") {
    return allTypes.map((type) => ({ label: capitalize(type), value: type }));
  }
  if (mode === "generation") {
    return generations.map((generation) => ({
      label: generation.label,
      value: String(generation.id),
    }));
  }
  if (mode === "number") {
    return pool.map((pokemon) => ({
      label: `#${String(pokemon.id).padStart(3, "0")}`,
      value: String(pokemon.id),
    }));
  }

  return pool
    .filter((pokemon) => pokemon.id !== current.id)
    .map((pokemon) => ({ label: pokemon.displayName, value: pokemon.displayName }));
}

function typoAllowance(length) {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

function levenshtein(left, right) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distances = Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0));

  for (let row = 0; row < rows; row += 1) distances[row][0] = row;
  for (let column = 0; column < columns; column += 1) distances[0][column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      distances[row][column] = Math.min(
        distances[row - 1][column] + 1,
        distances[row][column - 1] + 1,
        distances[row - 1][column - 1] + cost,
      );
    }
  }

  return distances[left.length][right.length];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function cleanKeyPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePokedexPokemon(entry, generationOverrides) {
  const id = Number(entry?.id ?? entry?.nationalDexNumber ?? entry?.number ?? entry?.dexNumber);
  if (!Number.isFinite(id)) return null;

  const name = cleanPokemonSlug(entry?.slug ?? entry?.name ?? entry?.species ?? entry?.displayName);
  const displayName = String(entry?.displayName ?? entry?.species ?? formatPokemonName(name)).trim();
  const generationId = getGenerationId(entry, id);
  const generationOverride = generationOverrides.get(generationId);
  const region = cleanKeyPart(entry?.region ?? generationOverride?.region ?? GENERATION_REGIONS.get(generationId) ?? "");

  return {
    id,
    name,
    displayName,
    generationId,
    generationLabel: entry?.generationLabel ?? generationOverride?.label ?? formatGenerationLabel(generationId),
    region,
    types: getPokedexTypes(entry),
    pokedexEntry: getPokedexEntryText(entry),
  };
}

function readGenerationOverrides(rawGenerations) {
  const output = new Map();
  if (!Array.isArray(rawGenerations)) return output;

  for (const generation of rawGenerations) {
    const id = parseGenerationId(generation?.id ?? generation?.generation ?? generation?.name);
    if (!id) continue;
    output.set(id, {
      name: generation?.name ?? `generation-${GENERATION_ROMANS.get(id) ?? id}`,
      label: generation?.label ?? generation?.displayName ?? formatGenerationLabel(id, generation?.name),
      region: cleanKeyPart(generation?.region ?? generation?.mainRegion ?? GENERATION_REGIONS.get(id) ?? ""),
    });
  }

  return output;
}

function getGenerationId(entry, id) {
  return (
    parseGenerationId(entry?.generationId) ||
    parseGenerationId(entry?.generation) ||
    parseGenerationId(entry?.gen) ||
    parseGenerationId(entry?.generationLabel) ||
    inferGenerationId(id)
  );
}

function parseGenerationId(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);

  const text = String(value ?? "").toLowerCase();
  const numericMatch = text.match(/\b(\d{1,2})\b/);
  if (numericMatch) return Number(numericMatch[1]);

  const romanMatch = text.match(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/);
  if (!romanMatch) return 0;
  for (const [id, roman] of GENERATION_ROMANS) {
    if (roman === romanMatch[1]) return id;
  }
  return 0;
}

function inferGenerationId(id) {
  const range = GENERATION_DEX_RANGES.find(([, min, max]) => id >= min && id <= max);
  return range?.[0] ?? 0;
}

function getPokedexTypes(entry) {
  const values = Array.isArray(entry?.types)
    ? entry.types
    : [entry?.type1, entry?.type2, entry?.primaryType, entry?.secondaryType];
  return [...new Set(values.map((type) => cleanType(type)).filter(Boolean))];
}

function cleanType(value) {
  return cleanKeyPart(value);
}

function cleanPokemonSlug(value) {
  return cleanKeyPart(value).replace(/-pokemon$/, "");
}

function getPokedexEntryText(entry) {
  const candidates = [
    entry?.pokedexEntry,
    entry?.flavorText,
    entry?.description,
    entry?.entry,
    ...(Array.isArray(entry?.entries) ? entry.entries : []),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return normalizeWhitespace(candidate);
    if (candidate && typeof candidate === "object") {
      const text = candidate.text ?? candidate.flavorText ?? candidate.description ?? candidate.entry;
      if (typeof text === "string" && text.trim()) return normalizeWhitespace(text);
    }
  }

  return "";
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
