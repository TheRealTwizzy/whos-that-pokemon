import { createProgressStore } from "./auth.mjs";
import {
  buildChoices,
  buildQuizPool,
  getLengthCap,
  getSpriteUrl,
  isCorrectAnswer,
  shuffle,
} from "./core.mjs";
import { loadPokemonCatalog } from "./pokemon-api.mjs";

const $ = (selector) => document.querySelector(selector);

if (location.href.startsWith("file:///android_asset/")) {
  document.documentElement.classList.add("native-app");
}

const elements = {
  authStatus: $("#auth-status"),
  login: $("#login-button"),
  logout: $("#logout-button"),
  catalogStatus: $("#catalog-status"),
  guessMode: $("#guess-mode"),
  answerStyle: $("#answer-style"),
  presentation: $("#presentation"),
  typeFilter: $("#type-filter"),
  generationFilter: $("#generation-filter"),
  searchFilter: $("#search-filter"),
  lengthButtons: [...document.querySelectorAll("[data-length]")],
  customLength: $("#custom-length"),
  start: $("#start-button"),
  refreshData: $("#refresh-data-button"),
  dexSummary: $("#dex-summary"),
  dexFill: $("#dex-fill"),
  dexList: $("#dex-list"),
  quizPanel: $("#quiz-panel"),
  summaryPanel: $("#summary-panel"),
  roundCount: $("#round-count"),
  score: $("#score"),
  poolCount: $("#pool-count"),
  art: $("#pokemon-art"),
  promptTitle: $("#prompt-title"),
  promptDetail: $("#prompt-detail"),
  form: $("#answer-form"),
  input: $("#guess-input"),
  guessButton: $("#guess-button"),
  choiceGrid: $("#choice-grid"),
  message: $("#message"),
  skip: $("#skip-button"),
  next: $("#next-button"),
  restart: $("#restart-button"),
  summaryText: $("#summary-text"),
  summaryRestart: $("#summary-restart-button"),
};

const state = {
  catalog: null,
  progress: null,
  lengthMode: "preset",
  lengthPreset: 25,
  rounds: [],
  choices: [],
  pool: [],
  currentIndex: 0,
  score: 0,
  revealed: false,
};

const progressStore = createProgressStore((progress) => {
  state.progress = progress;
  renderAuth();
  renderDex();
});

bindEvents();
await init();

function bindEvents() {
  elements.login.addEventListener("click", () => progressStore.signIn());
  elements.logout.addEventListener("click", () => progressStore.signOut());
  elements.refreshData.addEventListener("click", () => initCatalog({ forceRefresh: true }));
  elements.start.addEventListener("click", startQuiz);
  elements.form.addEventListener("submit", onGuessSubmit);
  elements.skip.addEventListener("click", revealCurrent);
  elements.next.addEventListener("click", nextRound);
  elements.restart.addEventListener("click", showSetup);
  elements.summaryRestart.addEventListener("click", showSetup);

  for (const control of [
    elements.guessMode,
    elements.answerStyle,
    elements.presentation,
    elements.typeFilter,
    elements.generationFilter,
    elements.searchFilter,
    elements.customLength,
  ]) {
    control.addEventListener("input", updateSetupPreview);
  }

  elements.lengthButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.lengthMode = "preset";
      state.lengthPreset = Number(button.dataset.length);
      elements.lengthButtons.forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      updateSetupPreview();
    });
  });

  elements.customLength.addEventListener("focus", () => {
    state.lengthMode = "custom";
    elements.lengthButtons.forEach((button) => button.setAttribute("aria-pressed", "false"));
    updateSetupPreview();
  });
}

async function init() {
  renderAuth();
  await Promise.all([progressStore.init(), initCatalog()]);
}

async function initCatalog({ forceRefresh = false } = {}) {
  elements.start.disabled = true;
  elements.catalogStatus.textContent = forceRefresh
    ? "Refreshing PokeAPI catalog..."
    : "Loading every generation from PokeAPI...";

  try {
    state.catalog = await loadPokemonCatalog({ forceRefresh });
    populateFilters();
    elements.catalogStatus.textContent =
      `Loaded ${state.catalog.pokemon.length} Pokemon across ${state.catalog.generations.length} generations.`;
    updateSetupPreview();
  } catch (error) {
    elements.catalogStatus.textContent = `Catalog load failed: ${error.message}`;
    elements.start.disabled = true;
  }
}

function populateFilters() {
  elements.typeFilter.replaceChildren(
    option("all", "All types"),
    ...state.catalog.types.map((type) => option(type, capitalize(type))),
  );
  elements.generationFilter.replaceChildren(
    option("all", "All generations"),
    ...state.catalog.generations.map((generation) =>
      option(String(generation.id), `${generation.label} (${capitalize(generation.region || "unknown")})`),
    ),
  );
}

function updateSetupPreview() {
  if (!state.catalog) return;
  state.pool = getFilteredPool();
  const length = getConfiguredLength(state.pool.length);
  elements.start.disabled = state.pool.length === 0;
  elements.catalogStatus.textContent =
    `${state.pool.length} Pokemon match filters. Next quiz will use ${length}.`;
  elements.customLength.max = String(Math.max(10, state.pool.length));
  renderDex();
}

function getFilteredPool() {
  return buildQuizPool(state.catalog.pokemon, {
    type: elements.typeFilter.value,
    generation: elements.generationFilter.value,
    search: elements.searchFilter.value,
  });
}

function getConfiguredLength(poolSize) {
  return getLengthCap({
    mode: state.lengthMode,
    preset: state.lengthPreset,
    custom: Number(elements.customLength.value),
    poolSize,
  });
}

function startQuiz() {
  state.pool = getFilteredPool();
  const length = getConfiguredLength(state.pool.length);
  if (length < 1) {
    setMessage("No Pokemon match those filters.", "wrong");
    return;
  }

  state.rounds = shuffle(state.pool).slice(0, length);
  state.currentIndex = 0;
  state.score = 0;
  state.revealed = false;
  elements.summaryPanel.classList.add("hidden");
  elements.quizPanel.classList.remove("hidden");
  renderRound();
}

function showSetup() {
  elements.quizPanel.classList.add("hidden");
  elements.summaryPanel.classList.add("hidden");
  elements.message.textContent = "";
}

function renderRound() {
  const pokemon = getCurrentPokemon();
  const roundNumber = state.currentIndex + 1;
  const presentation = elements.presentation.value;
  const guessMode = elements.guessMode.value;

  state.revealed = false;
  state.choices = [];
  elements.art.src = getSpriteUrl(pokemon.id);
  elements.art.alt = `${pokemon.displayName} quiz artwork`;
  elements.art.className = presentation === "silhouette" ? "silhouette" : "";
  elements.roundCount.textContent = `${roundNumber}/${state.rounds.length}`;
  elements.score.textContent = String(state.score);
  elements.poolCount.textContent = String(state.pool.length);
  elements.promptTitle.textContent = getPromptTitle(guessMode);
  elements.promptDetail.textContent = getPromptDetail(pokemon, guessMode);
  elements.input.value = "";
  elements.input.disabled = false;
  elements.guessButton.disabled = false;
  elements.skip.disabled = false;
  elements.next.classList.add("hidden");
  elements.message.textContent = "";
  elements.message.className = "message";

  if (elements.answerStyle.value === "choice") {
    renderChoices();
  } else {
    elements.form.classList.remove("hidden");
    elements.choiceGrid.classList.add("hidden");
    elements.input.placeholder = getInputPlaceholder(guessMode);
    elements.input.focus();
  }
}

function renderChoices() {
  const pokemon = getCurrentPokemon();
  state.choices = buildChoices({
    current: pokemon,
    pool: state.pool,
    mode: elements.guessMode.value,
    allTypes: state.catalog.types,
    generations: state.catalog.generations,
  });

  elements.form.classList.add("hidden");
  elements.choiceGrid.classList.remove("hidden");
  elements.choiceGrid.replaceChildren(
    ...state.choices.map((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice.label;
      button.dataset.value = choice.value;
      button.addEventListener("click", () => onChoice(choice, button));
      return button;
    }),
  );
}

function onGuessSubmit(event) {
  event.preventDefault();
  if (state.revealed) return nextRound();

  const pokemon = getCurrentPokemon();
  const correct = isCorrectAnswer(
    elements.input.value,
    pokemon,
    elements.guessMode.value,
    state.catalog.pokemon,
  );

  if (!correct) {
    setMessage(`No match for "${elements.input.value.trim()}".`, "wrong");
    return;
  }

  handleCorrect();
}

function onChoice(choice, button) {
  if (state.revealed) return;
  const pokemon = getCurrentPokemon();
  const correct = choice.correct || isCorrectAnswer(choice.value, pokemon, elements.guessMode.value, state.catalog.pokemon);
  button.classList.add(correct ? "correct" : "wrong");
  if (!correct) {
    setMessage("No match. Try another choice.", "wrong");
    return;
  }

  handleCorrect();
}

async function handleCorrect() {
  const pokemon = getCurrentPokemon();
  state.score += 1;
  elements.score.textContent = String(state.score);
  await progressStore.recordCorrectPokemon(pokemon.id);
  revealPokemon(`Correct. ${getRevealText(pokemon)}`, "correct");
}

function revealCurrent() {
  if (state.revealed) return nextRound();
  revealPokemon(getRevealText(getCurrentPokemon()), "wrong");
}

function revealPokemon(message, tone) {
  state.revealed = true;
  elements.art.className = "";
  elements.input.disabled = true;
  elements.guessButton.disabled = true;
  elements.skip.disabled = true;
  elements.next.classList.remove("hidden");
  elements.choiceGrid.querySelectorAll("button").forEach((button) => {
    const correct = state.choices.find((choice) => choice.value === button.dataset.value)?.correct;
    if (correct) button.classList.add("correct");
    button.disabled = true;
  });
  setMessage(message, tone);
}

function nextRound() {
  if (state.currentIndex + 1 >= state.rounds.length) {
    finishQuiz();
    return;
  }

  state.currentIndex += 1;
  renderRound();
}

function finishQuiz() {
  const percent = Math.round((state.score / state.rounds.length) * 100);
  elements.quizPanel.classList.add("hidden");
  elements.summaryPanel.classList.remove("hidden");
  elements.summaryText.textContent =
    `You scored ${state.score} of ${state.rounds.length} (${percent}%). Correct guesses were added to your Pokedex.`;
  renderDex();
}

function renderAuth() {
  const progress = state.progress ?? progressStore.getState();
  elements.authStatus.textContent = progress.status;
  elements.login.disabled = !progress.authAvailable;
  elements.login.classList.toggle("hidden", Boolean(progress.user));
  elements.logout.classList.toggle("hidden", !progress.user);
}

function renderDex() {
  if (!state.catalog) return;
  const caughtIds = new Set((state.progress ?? progressStore.getState()).correctPokemonIds);
  const filtered = state.pool.length ? state.pool : getFilteredPool();
  const caughtTotal = caughtIds.size;
  const caughtInFilter = filtered.filter((pokemon) => caughtIds.has(pokemon.id)).length;
  const allTotal = state.catalog.pokemon.length;
  const percent = allTotal ? Math.round((caughtTotal / allTotal) * 100) : 0;

  elements.dexSummary.textContent =
    `${caughtTotal}/${allTotal} total caught. ${caughtInFilter}/${filtered.length} in current filter.`;
  elements.dexFill.style.width = `${percent}%`;
  elements.dexList.replaceChildren(
    ...filtered.slice(0, 300).map((pokemon) => renderDexEntry(pokemon, caughtIds.has(pokemon.id))),
  );
}

function renderDexEntry(pokemon, caught) {
  const row = document.createElement("div");
  row.className = "dex-entry";
  row.dataset.caught = String(caught);
  row.innerHTML = `
    <strong>#${String(pokemon.id).padStart(3, "0")}</strong>
    <span>${caught ? pokemon.displayName : "Unknown"}</span>
    <span>${caught ? pokemon.types.map(capitalize).join(" / ") : pokemon.generationLabel}</span>
  `;
  return row;
}

function getPromptTitle(mode) {
  if (mode === "type") return "Guess a type";
  if (mode === "generation") return "Guess the generation";
  if (mode === "number") return "Guess the Pokedex number";
  return "Guess the Pokemon name";
}

function getPromptDetail(pokemon, mode) {
  if (mode === "type") return `Name shown after reveal. ${pokemon.generationLabel}.`;
  if (mode === "generation") return `Name shown after reveal. Region answers are accepted.`;
  if (mode === "number") return `Name shown after reveal. Plain numbers like 25 or 025 work.`;
  return `Types: ${pokemon.types.map(capitalize).join(" / ") || "Unknown"}.`;
}

function getInputPlaceholder(mode) {
  if (mode === "type") return "Example: electric";
  if (mode === "generation") return "Example: gen 1 or kanto";
  if (mode === "number") return "Example: 25";
  return "Example: Pikachu";
}

function getRevealText(pokemon) {
  return `${pokemon.displayName} is #${String(pokemon.id).padStart(3, "0")} from ${pokemon.generationLabel}.`;
}

function getCurrentPokemon() {
  return state.rounds[state.currentIndex];
}

function setMessage(text, tone = "") {
  elements.message.textContent = text;
  elements.message.className = `message ${tone}`.trim();
}

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
