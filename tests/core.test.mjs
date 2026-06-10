import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChoices,
  buildLeaderboardKey,
  buildQuizPool,
  formatPokemonName,
  formatElapsedTime,
  getLengthCap,
  isCorrectAnswer,
  isBetterScore,
  isLeaderboardEligible,
  mergeIdSets,
  normalizeAnswer,
} from "../src/core.mjs";
import { idFromResource } from "../src/pokemon-api.mjs";

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

test("formats elapsed timed quiz values as mm:ss.t", () => {
  assert.equal(formatElapsedTime(0), "00:00.0");
  assert.equal(formatElapsedTime(4250), "00:04.2");
  assert.equal(formatElapsedTime(61_980), "01:01.9");
  assert.equal(formatElapsedTime(10 * 60_000 + 4_090), "10:04.0");
});

test("builds stable leaderboard keys from quiz settings", () => {
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
  const settings = {
    timed: true,
    lengthMode: "preset",
    length: 50,
    guessMode: "type",
    answerStyle: "choice",
    presentation: "color",
    type: "all",
    generation: "all",
    search: "",
  };
  const user = { uid: "abc123", displayName: "Ash" };

  assert.equal(isLeaderboardEligible(settings, user), true);
  assert.equal(isLeaderboardEligible({ ...settings, timed: false }, user), false);
  assert.equal(isLeaderboardEligible({ ...settings, length: 10 }, user), false);
  assert.equal(isLeaderboardEligible({ ...settings, lengthMode: "custom" }, user), false);
  assert.equal(isLeaderboardEligible(settings, null), false);
});

test("compares leaderboard scores by correct answers then faster elapsed time", () => {
  assert.equal(isBetterScore({ correct: 20, elapsedMs: 90_000 }, { correct: 19, elapsedMs: 1 }), true);
  assert.equal(isBetterScore({ correct: 20, elapsedMs: 80_000 }, { correct: 20, elapsedMs: 90_000 }), true);
  assert.equal(isBetterScore({ correct: 19, elapsedMs: 1 }, { correct: 20, elapsedMs: 90_000 }), false);
  assert.equal(isBetterScore({ correct: 20, elapsedMs: 90_000 }, null), true);
});
