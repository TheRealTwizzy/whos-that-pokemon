import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutofillSuggestions,
  buildChoices,
  buildLeaderboardKey,
  buildQuizPool,
  detectInputDeviceClass,
  getAccessGate,
  getAvailableQuestionOptions,
  getGoogleAuthEnvironmentStatus,
  getSpriteUrl,
  formatPokemonName,
  formatElapsedTime,
  getLengthCap,
  getTrainerPreferenceDefaults,
  isAttemptSubmission,
  isCorrectAnswer,
  isBetterScore,
  isLeaderboardEligible,
  mergeIdSets,
  moveMenuCursor,
  normalizeTrainerPreferences,
  normalizePokedexCatalog,
  normalizeAnswer,
  resolveQuizSettings,
  shouldTrackPokedexForRun,
  shouldRejectQuizEvent,
} from "../src/core.mjs";
import { idFromResource, normalizeStaticCatalog } from "../src/pokemon-api.mjs";

const SAMPLE_POKEMON = [
  {
    id: 1,
    name: "bulbasaur",
    displayName: "Bulbasaur",
    generationId: 1,
    generationLabel: "Generation I",
    region: "kanto",
    types: ["grass", "poison"],
  },
  {
    id: 4,
    name: "charmander",
    displayName: "Charmander",
    generationId: 1,
    generationLabel: "Generation I",
    region: "kanto",
    types: ["fire"],
  },
  {
    id: 25,
    name: "pikachu",
    displayName: "Pikachu",
    generationId: 1,
    generationLabel: "Generation I",
    region: "kanto",
    types: ["electric"],
  },
  {
    id: 152,
    name: "chikorita",
    displayName: "Chikorita",
    generationId: 2,
    generationLabel: "Generation II",
    region: "johto",
    types: ["grass"],
  },
  {
    id: 439,
    name: "mime-jr",
    displayName: "Mime Jr.",
    generationId: 4,
    generationLabel: "Generation IV",
    region: "sinnoh",
    types: ["psychic", "fairy"],
  },
];

test("formats PokeAPI slugs into readable Pokemon names", () => {
  assert.equal(formatPokemonName("mr-mime"), "Mr. Mime");
  assert.equal(formatPokemonName("nidoran-f"), "Nidoran♀");
  assert.equal(formatPokemonName("type-null"), "Type: Null");
  assert.equal(formatPokemonName("jangmo-o"), "Jangmo-o");
});

test("reads resource ids from direct PokeAPI id fields or urls", () => {
  assert.equal(idFromResource({ id: 9 }), 9);
  assert.equal(idFromResource({ url: "https://pokeapi.co/api/v2/generation/3/" }), 3);
});

test("filters quiz pool by type, generation, number, and name", () => {
  const filtered = buildQuizPool(SAMPLE_POKEMON, {
    type: "grass",
    generation: "2",
    search: "152",
  });

  assert.deepEqual(filtered.map((pokemon) => pokemon.name), ["chikorita"]);

  const nameFiltered = buildQuizPool(SAMPLE_POKEMON, {
    type: "all",
    generation: "all",
    search: "mime",
  });
  assert.deepEqual(nameFiltered.map((pokemon) => pokemon.name), ["mime-jr"]);
});

test("normalizes punctuation, symbols, and whitespace for typed answers", () => {
  assert.equal(normalizeAnswer("Mr. Mime"), "mrmime");
  assert.equal(normalizeAnswer("Nidoran♀"), "nidoranfemale");
  assert.equal(normalizeAnswer("Type: Null"), "typenull");
});

test("checks answer modes for name, type, generation, and Pokedex number", () => {
  const bulbasaur = SAMPLE_POKEMON[0];

  assert.equal(isCorrectAnswer("bulbasuar", bulbasaur, "name", SAMPLE_POKEMON), true);
  assert.equal(isCorrectAnswer("Charmander", bulbasaur, "name", SAMPLE_POKEMON), false);
  assert.equal(isCorrectAnswer("poison", bulbasaur, "type", SAMPLE_POKEMON), true);
  assert.equal(isCorrectAnswer("gen 1", bulbasaur, "generation", SAMPLE_POKEMON), true);
  assert.equal(isCorrectAnswer("kanto", bulbasaur, "generation", SAMPLE_POKEMON), true);
  assert.equal(isCorrectAnswer("001", bulbasaur, "number", SAMPLE_POKEMON), true);
});

test("caps quiz lengths to requested presets, custom max, and pool size", () => {
  assert.equal(getLengthCap({ mode: "preset", preset: 25, custom: 10, poolSize: 200 }), 25);
  assert.equal(getLengthCap({ mode: "preset", preset: 250, custom: 10, poolSize: 40 }), 40);
  assert.equal(getLengthCap({ mode: "custom", preset: 25, custom: 8, poolSize: 200 }), 10);
  assert.equal(getLengthCap({ mode: "custom", preset: 25, custom: 9999, poolSize: 200 }), 200);
});

test("normalizes trainer preferences to safe avatar, theme, and quiz defaults", () => {
  const defaults = getTrainerPreferenceDefaults();

  assert.deepEqual(normalizeTrainerPreferences(null, { poolSize: 1025 }), defaults);
  assert.deepEqual(
    normalizeTrainerPreferences({
      avatarId: "9999",
      themeId: "invalid",
      quizDefaults: {
        guessMode: "color",
        answerStyle: "voice",
        presentation: "xray",
        timed: "yes",
        leaderboard: true,
        lengthMode: "custom",
        lengthPreset: 999,
        customLength: 4,
        type: "Electric",
        generation: "2",
        search: "  pika  ",
      },
    }, { poolSize: 151 }),
    {
      avatarId: 25,
      themeId: "classic",
      quizDefaults: {
        generation: "2",
        questions: "25",
        answerStyle: "typed",
        timed: true,
        leaderboard: true,
      },
    },
  );
});

test("saved quiz defaults normalize removed settings into v2 leaderboard policy", () => {
  const preferences = normalizeTrainerPreferences({
    quizDefaults: {
      timed: true,
      leaderboard: true,
      lengthMode: "custom",
      customLength: 150,
      guessMode: "type",
      answerStyle: "choice",
      presentation: "color",
      type: "electric",
      search: "pika",
      generation: "1",
    },
  }, { poolSize: 151 });

  assert.deepEqual(preferences.quizDefaults, {
    generation: "1",
    questions: "entire-generation",
    answerStyle: "choice",
    timed: true,
    leaderboard: true,
  });
  const settings = resolveQuizSettings({ ...preferences.quizDefaults, poolSize: 151 });
  assert.equal(isLeaderboardEligible(settings, { uid: "google-1", provider: "google" }), true);
  assert.equal(
    isLeaderboardEligible(settings, { uid: "site:red", provider: "site" }),
    false,
  );
});

test("resolves focused quiz settings and suppresses duplicate full-generation presets", () => {
  assert.deepEqual(getAvailableQuestionOptions({ generation: "2", poolSize: 100 }), [
    { value: "25", label: "25", publicEligible: true, disabled: false },
    { value: "50", label: "50", publicEligible: true, disabled: false },
    { value: "entire-generation", label: "Entire Generation", publicEligible: true, disabled: false },
  ]);

  assert.deepEqual(resolveQuizSettings({
    generation: "2",
    questions: "100",
    answerStyle: "choice",
    timed: true,
    leaderboard: true,
    poolSize: 100,
  }), {
    version: "v2",
    generation: "2",
    questionToken: "entire-generation",
    length: 100,
    answerStyle: "choice",
    inputDevice: "keyboard",
    timed: true,
    leaderboard: true,
    publicEligiblePreset: true,
  });
});

test("keeps national All Pokemon personal-only and serializes v2 board keys", () => {
  const settings = resolveQuizSettings({
    generation: "all",
    questions: "all-pokemon",
    answerStyle: "typed",
    timed: true,
    leaderboard: true,
    poolSize: 1025,
  });

  assert.equal(settings.leaderboard, false);
  assert.equal(settings.publicEligiblePreset, false);
  assert.equal(buildLeaderboardKey(settings), "v2|gen:all|q:all-pokemon|total:1025|answer:typed|device:keyboard");
  assert.equal(isLeaderboardEligible(settings, { uid: "google-1", provider: "google" }), false);

  const standard = resolveQuizSettings({
    generation: "all",
    questions: "100",
    answerStyle: "typed",
    timed: true,
    leaderboard: true,
    poolSize: 1025,
  });
  assert.equal(buildLeaderboardKey(standard), "v2|gen:all|q:100|total:100|answer:typed|device:keyboard");
  assert.equal(isLeaderboardEligible(standard, { uid: "google-1", provider: "google" }), true);
});

test("splits v2 timed leaderboard keys by automatic input device class", () => {
  const keyboardRun = resolveQuizSettings({
    generation: "1",
    questions: "25",
    answerStyle: "typed",
    timed: true,
    leaderboard: true,
    poolSize: 151,
    inputDevice: "keyboard",
  });
  const touchRun = resolveQuizSettings({
    generation: "1",
    questions: "25",
    answerStyle: "typed",
    timed: true,
    leaderboard: true,
    poolSize: 151,
    inputDevice: "touch",
  });

  assert.equal(
    buildLeaderboardKey(keyboardRun),
    "v2|gen:1|q:25|total:25|answer:typed|device:keyboard",
  );
  assert.equal(
    buildLeaderboardKey(touchRun),
    "v2|gen:1|q:25|total:25|answer:typed|device:touch",
  );
});

test("detects leaderboard input device class without adding a player setting", () => {
  assert.equal(detectInputDeviceClass({ pointer: "coarse", maxTouchPoints: 5 }), "touch");
  assert.equal(detectInputDeviceClass({ pointer: "fine", maxTouchPoints: 0 }), "keyboard");
  assert.equal(
    detectInputDeviceClass({
      pointer: "fine",
      maxTouchPoints: 5,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    }),
    "keyboard",
  );
  assert.equal(
    detectInputDeviceClass({
      pointer: "fine",
      maxTouchPoints: 5,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148",
    }),
    "touch",
  );
});

test("untimed quizzes cannot submit leaderboard scores or track PokeDex entries", () => {
  const casual = resolveQuizSettings({
    generation: "1",
    questions: "25",
    answerStyle: "typed",
    timed: false,
    leaderboard: true,
    poolSize: 151,
    inputDevice: "keyboard",
  });
  const timedPersonal = resolveQuizSettings({
    generation: "1",
    questions: "25",
    answerStyle: "typed",
    timed: true,
    leaderboard: false,
    poolSize: 151,
    inputDevice: "keyboard",
  });

  assert.equal(casual.timed, false);
  assert.equal(casual.leaderboard, false);
  assert.equal(isLeaderboardEligible(casual, { uid: "google-1", provider: "google" }), false);
  assert.equal(shouldTrackPokedexForRun(casual), false);
  assert.equal(shouldTrackPokedexForRun({ ...casual, timed: true, rejected: true }), false);
  assert.equal(isLeaderboardEligible(timedPersonal, { uid: "google-1", provider: "google" }), false);
  assert.equal(shouldTrackPokedexForRun(timedPersonal), true);
});

test("builds normalized typed autofill suggestions without submitting", () => {
  const suggestions = buildAutofillSuggestions("mime", SAMPLE_POKEMON, { limit: 5 });
  assert.deepEqual(suggestions, [
    { id: 439, label: "Mime Jr.", value: "Mime Jr." },
  ]);
});

test("autofill corrects close Pokemon name misspellings without overfilling the LCD", () => {
  assert.deepEqual(buildAutofillSuggestions("p", SAMPLE_POKEMON), []);

  assert.deepEqual(buildAutofillSuggestions("piakchu", [
    ...SAMPLE_POKEMON,
    { id: 172, name: "pichu", displayName: "Pichu" },
  ]), [
    { id: 25, label: "Pikachu", value: "Pikachu" },
  ]);

  const broadPool = [
    ...SAMPLE_POKEMON,
    { id: 16, name: "pidgey", displayName: "Pidgey" },
    { id: 17, name: "pidgeotto", displayName: "Pidgeotto" },
    { id: 18, name: "pidgeot", displayName: "Pidgeot" },
  ];
  assert.deepEqual(buildAutofillSuggestions("pi", broadPool).map((suggestion) => suggestion.label), [
    "Pidgeot",
    "Pidgeotto",
    "Pidgey",
  ]);
});

test("classifies typed attempts and quiz rejection events", () => {
  assert.equal(isAttemptSubmission(""), false);
  assert.equal(isAttemptSubmission("   "), false);
  assert.equal(isAttemptSubmission("Pika"), true);

  assert.equal(shouldRejectQuizEvent({ type: "paste" }), true);
  assert.equal(shouldRejectQuizEvent({ type: "drop" }), true);
  assert.equal(shouldRejectQuizEvent({ type: "visibilitychange", hidden: true }), true);
  assert.equal(shouldRejectQuizEvent({ type: "pagehide" }), true);
  assert.equal(shouldRejectQuizEvent({ type: "blur", targetWithinPage: true }), false);
});

test("moves GBC menu cursor through command slots with wraparound", () => {
  assert.equal(moveMenuCursor(0, "next", 4), 1);
  assert.equal(moveMenuCursor(3, "next", 4), 0);
  assert.equal(moveMenuCursor(0, "previous", 4), 3);
  assert.equal(moveMenuCursor(99, "next", 4), 0);
  assert.equal(moveMenuCursor(0, "next", 0), -1);
});

test("builds multiple-choice options with a correct answer and no duplicates", () => {
  const options = buildChoices({
    current: SAMPLE_POKEMON[0],
    pool: SAMPLE_POKEMON,
    mode: "type",
    allTypes: ["grass", "poison", "fire", "water", "electric"],
    generations: [
      { id: 1, label: "Generation I", region: "kanto" },
      { id: 2, label: "Generation II", region: "johto" },
    ],
    random: () => 0,
  });

  assert.equal(options.length, 4);
  assert.equal(new Set(options.map((option) => option.value)).size, options.length);
  assert.equal(options.some((option) => option.correct), true);
});

test("does not include a second correct type as a false multiple-choice distractor", () => {
  const options = buildChoices({
    current: SAMPLE_POKEMON[0],
    pool: SAMPLE_POKEMON,
    mode: "type",
    allTypes: ["grass", "poison", "fire", "water", "electric"],
    generations: [],
    random: () => 0,
  });

  const falseDistractors = options.filter(
    (option) => !option.correct && SAMPLE_POKEMON[0].types.includes(option.value),
  );
  assert.deepEqual(falseDistractors, []);
});

test("merges locally and remotely tracked Pokedex ids without duplicates", () => {
  assert.deepEqual(mergeIdSets([1, 4, 4], [4, 25, 152]), [1, 4, 25, 152]);
});

test("keeps the app locked until a guest, registered, or Google session exists", () => {
  assert.deepEqual(getAccessGate({ authReady: false, access: null, user: null }), {
    locked: true,
    method: "loading",
    label: "Booting PokéOS login...",
  });
  assert.deepEqual(getAccessGate({ authReady: true, access: null, user: null }), {
    locked: true,
    method: "locked",
    label: "PokéOS login required. Choose Guest, Local Account, or Google.",
  });
  assert.equal(getAccessGate({ authReady: true, access: { method: "guest" }, user: null }).locked, false);
  assert.equal(getAccessGate({ authReady: true, access: { method: "registered" }, user: null }).locked, false);
  assert.deepEqual(getAccessGate({ authReady: true, access: null, user: { uid: "google-1" } }), {
    locked: false,
    method: "google",
    label: "Google account logged in.",
  });
});

test("detects embedded WebView environments that cannot run Google OAuth", () => {
  const webViewUserAgent =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36";
  const chromeUserAgent =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.231005.007) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
  const iosWebViewUserAgent =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/15E148";

  assert.deepEqual(
    getGoogleAuthEnvironmentStatus({
      href: "https://therealtwizzy.github.io/whos-that-pokemon/",
      userAgent: webViewUserAgent,
    }),
    {
      supported: false,
      reason: "embedded-webview",
      message: "Google sign-in is available in Chrome. Use Guest or a local Trainer ID in this app.",
    },
  );
  assert.deepEqual(
    getGoogleAuthEnvironmentStatus({
      href: "file:///android_asset/index.html",
      userAgent: chromeUserAgent,
    }),
    {
      supported: false,
      reason: "native-asset",
      message: "Google sign-in is available in Chrome. Use Guest or a local Trainer ID in this app.",
    },
  );
  assert.deepEqual(
    getGoogleAuthEnvironmentStatus({
      href: "https://therealtwizzy.github.io/whos-that-pokemon/",
      userAgent: iosWebViewUserAgent,
    }),
    {
      supported: false,
      reason: "embedded-webview",
      message: "Google sign-in is available in Chrome. Use Guest or a local Trainer ID in this app.",
    },
  );
  assert.deepEqual(
    getGoogleAuthEnvironmentStatus({
      href: "https://therealtwizzy.github.io/whos-that-pokemon/",
      userAgent: chromeUserAgent,
    }),
    {
      supported: true,
      reason: "supported-browser",
      message: "Google sign-in is available.",
    },
  );
});

test("normalizes structured Pokedex data into a quiz catalog with log entries", () => {
  const catalog = normalizePokedexCatalog({
    pokemon: [
      {
        nationalDexNumber: 25,
        slug: "pikachu",
        species: "Pikachu",
        generation: 1,
        region: "kanto",
        types: ["Electric"],
        flavorText: "When it is angered, it immediately discharges the energy stored in the pouches in its cheeks.",
      },
      {
        id: 906,
        name: "sprigatito",
        generationLabel: "Generation IX",
        type1: "Grass",
        pokedexEntry: "Its fluffy fur is similar in composition to plants.",
      },
    ],
  }, { loadedAt: 1234 });

  assert.equal(catalog.loadedAt, 1234);
  assert.deepEqual(catalog.pokemon.map((pokemon) => pokemon.id), [25, 906]);
  assert.equal(catalog.pokemon[0].displayName, "Pikachu");
  assert.deepEqual(catalog.pokemon[0].types, ["electric"]);
  assert.equal(catalog.pokemon[0].pokedexEntry.startsWith("When it is angered"), true);
  assert.equal(catalog.pokemon[1].generationId, 9);
  assert.equal(catalog.pokemon[1].region, "paldea");
  assert.equal(catalog.generations.some((generation) => generation.id === 9), true);
});

test("formats elapsed timed quiz values as mm:ss.t", () => {
  assert.equal(formatElapsedTime(0), "00:00.0");
  assert.equal(formatElapsedTime(4250), "00:04.2");
  assert.equal(formatElapsedTime(61_980), "01:01.9");
  assert.equal(formatElapsedTime(10 * 60_000 + 4_090), "10:04.0");
});

test("keeps legacy leaderboard keys isolated from v2 settings", () => {
  const settings = {
    timed: true,
    lengthMode: "preset",
    length: 25,
    guessMode: "name",
    answerStyle: "input",
    presentation: "silhouette",
    type: "electric",
    generation: "1",
    search: "Pikachu",
  };

  assert.equal(
    buildLeaderboardKey(settings),
    "v1|len:25|guess:name|style:input|present:silhouette|type:electric|gen:1|search:pikachu",
  );
  assert.equal(
    buildLeaderboardKey({ ...settings, search: "  PIKACHU  " }),
    buildLeaderboardKey(settings),
  );
});

test("allows public leaderboard submission only for signed-in timed standard-length quizzes", () => {
  const settings = resolveQuizSettings({
    timed: true,
    leaderboard: true,
    generation: "all",
    questions: "50",
    answerStyle: "choice",
    poolSize: 1025,
  });
  const user = { uid: "abc123", displayName: "Ash", provider: "google" };

  assert.equal(isLeaderboardEligible(settings, user), true);
  assert.equal(isLeaderboardEligible({ ...settings, timed: false }, user), false);
  assert.equal(isLeaderboardEligible({ ...settings, leaderboard: false }, user), false);
  assert.equal(isLeaderboardEligible({ ...settings, publicEligiblePreset: false }, user), false);
  assert.equal(isLeaderboardEligible(settings, { uid: "guest", provider: "guest" }), false);
  assert.equal(isLeaderboardEligible(settings, { uid: "site:ash", provider: "site" }), false);
  assert.equal(isLeaderboardEligible(settings, null), false);
});

test("compares leaderboard scores by correct answers then faster elapsed time", () => {
  assert.equal(isBetterScore({ correct: 20, elapsedMs: 90_000 }, { correct: 19, elapsedMs: 1 }), true);
  assert.equal(isBetterScore({ correct: 20, elapsedMs: 80_000 }, { correct: 20, elapsedMs: 90_000 }), true);
  assert.equal(isBetterScore({ correct: 19, elapsedMs: 1 }, { correct: 20, elapsedMs: 90_000 }), false);
  assert.equal(isBetterScore({ correct: 20, elapsedMs: 90_000 }, null), true);
});

test("normalizes static Pokedex data into the catalog shape used by the quiz", () => {
  const catalog = normalizeStaticCatalog({
    pokemon: [
      {
        id: 25,
        name: "pikachu",
        displayName: "Pikachu",
        generationId: 1,
        generationLabel: "Generation I",
        region: "kanto",
        types: ["electric"],
        heightM: 0.4,
        weightKg: 6,
        category: "Mouse Pokemon",
        abilities: ["static", "lightning-rod"],
        description: "An Electric type Pokemon first discovered in Kanto.",
        artwork: "https://example.com/pikachu.png",
        sprites: {
          frontDefault: "https://example.com/pikachu-pixel.png",
          officialArtwork: "https://example.com/pikachu-official.png",
        },
      },
    ],
    generations: [{ id: 1, label: "Generation I", region: "kanto" }],
    types: ["electric"],
  });

  assert.equal(catalog.pokemon.length, 1);
  assert.equal(catalog.pokemon[0].displayName, "Pikachu");
  assert.equal(catalog.pokemon[0].spriteUrl, "https://example.com/pikachu-pixel.png");
  assert.equal(catalog.pokemon[0].artworkUrl, "https://example.com/pikachu.png");
  assert.deepEqual(catalog.types, ["electric"]);
  assert.deepEqual(catalog.generations.map((generation) => generation.label), ["Generation I"]);
});

test("uses pixel sprite URLs for in-LCD Pokemon rendering fallbacks", () => {
  assert.equal(
    getSpriteUrl(25),
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png",
  );
});
