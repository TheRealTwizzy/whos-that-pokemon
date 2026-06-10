import { createProgressStore } from "./auth.mjs";
import {
  buildLeaderboardKey,
  buildChoices,
  buildQuizPool,
  formatElapsedTime,
  getLengthCap,
  getSpriteUrl,
  isCorrectAnswer,
  isLeaderboardEligible,
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
  timedToggle: $("#timed-toggle"),
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
  leaderboardSummary: $("#leaderboard-summary"),
  leaderboardList: $("#leaderboard-list"),
  quizPanel: $("#quiz-panel"),
  summaryPanel: $("#summary-panel"),
  roundCount: $("#round-count"),
  score: $("#score"),
  poolCount: $("#pool-count"),
  timerDisplay: $("#timer-display"),
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
  currentSettings: null,
  currentBoardKey: "",
  currentIndex: 0,
  score: 0,
  revealed: false,
  timerId: null,
  timerStartedAt: 0,
  elapsedMs: 0,
};

let leaderboardRequestId = 0;

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
    elements.timedToggle,
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
  state.currentSettings = getQuizSettings(state.pool.length);
  state.currentBoardKey = buildLeaderboardKey(state.currentSettings);
  elements.start.disabled = state.pool.length === 0;
  elements.catalogStatus.textContent =
    `${state.pool.length} Pokemon match filters. Next quiz will use ${length}.`;
  elements.customLength.max = String(Math.max(10, state.pool.length));
  renderDex();
  void renderLeaderboard();
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

function getQuizSettings(poolSize = state.pool.length) {
  return {
    timed: elements.timedToggle.checked,
    lengthMode: state.lengthMode,
    length: getConfiguredLength(poolSize),
    guessMode: elements.guessMode.value,
    answerStyle: elements.answerStyle.value,
    presentation: elements.presentation.value,
    type: elements.typeFilter.value,
    generation: elements.generationFilter.value,
    search: elements.searchFilter.value.trim(),
  };
}

function startQuiz() {
  state.pool = getFilteredPool();
  state.currentSettings = getQuizSettings(state.pool.length);
  state.currentBoardKey = buildLeaderboardKey(state.currentSettings);
  const length = state.currentSettings.length;
  if (length < 1) {
    setMessage("No Pokemon match those filters.", "wrong");
    return;
  }

  state.rounds = shuffle(state.pool).slice(0, length);
  state.currentIndex = 0;
  state.score = 0;
  state.revealed = false;
  startTimer();
  elements.summaryPanel.classList.add("hidden");
  elements.quizPanel.classList.remove("hidden");
  renderRound();
}

function showSetup() {
  stopTimer();
  elements.quizPanel.classList.add("hidden");
  elements.summaryPanel.classList.add("hidden");
  elements.message.textContent = "";
  renderTimer();
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
  renderTimer();
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
    void finishQuiz();
    return;
  }

  state.currentIndex += 1;
  renderRound();
}

async function finishQuiz() {
  const elapsedMs = stopTimer();
  const percent = Math.round((state.score / state.rounds.length) * 100);
  elements.quizPanel.classList.add("hidden");
  elements.summaryPanel.classList.remove("hidden");
  const scoreResult = await recordTimedScore(elapsedMs);
  elements.summaryText.textContent = [
    `You scored ${state.score} of ${state.rounds.length} (${percent}%).`,
    state.currentSettings.timed ? `Time: ${formatElapsedTime(elapsedMs)}.` : "",
    scoreResult,
    "Correct guesses were added to your Pokedex.",
  ].filter(Boolean).join(" ");
  renderDex();
  await renderLeaderboard();
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

async function renderLeaderboard() {
  if (!state.catalog) return;

  const requestId = ++leaderboardRequestId;
  const settings = getQuizSettings(state.pool.length || getFilteredPool().length);
  const boardKey = buildLeaderboardKey(settings);
  const progress = state.progress ?? progressStore.getState();
  const personalBest = progress.personalScores?.[boardKey];

  if (!settings.timed) {
    elements.leaderboardSummary.textContent = "Turn on Timed to view scores for these settings.";
    renderLeaderboardRows([]);
    return;
  }

  if (settings.lengthMode === "custom") {
    elements.leaderboardSummary.textContent = personalBest
      ? `Custom timed personal best: ${personalBest.correct}/${personalBest.total} in ${formatElapsedTime(personalBest.elapsedMs)}.`
      : "Custom timed runs save personal bests only.";
    renderLeaderboardRows([]);
    return;
  }

  if (!isLeaderboardEligible(settings, { uid: "leaderboard-preview" })) {
    elements.leaderboardSummary.textContent =
      "Public leaderboards require an actual 25, 50, 150, or 250-question timed quiz.";
    renderLeaderboardRows([]);
    return;
  }

  elements.leaderboardSummary.textContent = personalBest
    ? `Your best here: ${personalBest.correct}/${personalBest.total} in ${formatElapsedTime(personalBest.elapsedMs)}. Loading public scores...`
    : "Loading public scores for these settings...";

  try {
    const scores = await progressStore.loadLeaderboard(boardKey);
    if (requestId !== leaderboardRequestId) return;
    elements.leaderboardSummary.textContent = scores.length
      ? "Public timed leaderboard for the current setup."
      : "No public scores for this setup yet.";
    renderLeaderboardRows(scores);
  } catch (error) {
    if (requestId !== leaderboardRequestId) return;
    elements.leaderboardSummary.textContent = `Leaderboard unavailable: ${error.message}`;
    renderLeaderboardRows([]);
  }
}

function renderLeaderboardRows(scores) {
  if (!scores.length) {
    const empty = document.createElement("div");
    empty.className = "leaderboard-empty";
    empty.textContent = "No scores to show.";
    elements.leaderboardList.replaceChildren(empty);
    return;
  }

  elements.leaderboardList.replaceChildren(
    ...scores.map((score, index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-entry";
      row.innerHTML = `
        <span class="rank">#${index + 1}</span>
        <span>${escapeText(score.displayName || "Trainer")}</span>
        <span>${Number(score.correct)}/${Number(score.total)}</span>
        <span>${formatElapsedTime(score.elapsedMs)}</span>
      `;
      return row;
    }),
  );
}

async function recordTimedScore(elapsedMs) {
  if (!state.currentSettings?.timed) return "";

  const progress = state.progress ?? progressStore.getState();
  const score = {
    boardKey: state.currentBoardKey,
    uid: progress.user?.uid ?? "guest",
    displayName: progress.user?.displayName ?? "Guest",
    correct: state.score,
    total: state.rounds.length,
    elapsedMs,
    accuracy: state.rounds.length ? state.score / state.rounds.length : 0,
    settings: state.currentSettings,
    completedAt: new Date().toISOString(),
  };

  const personal = await progressStore.recordPersonalScore(state.currentBoardKey, score);
  const personalText = personal.saved ? "New personal best saved." : "Personal best unchanged.";

  if (!isLeaderboardEligible(state.currentSettings, progress.user)) {
    if (state.currentSettings.lengthMode === "custom") {
      return `${personalText} Custom timed runs do not submit publicly.`;
    }
    if (!isLeaderboardEligible(state.currentSettings, { uid: "leaderboard-preview" })) {
      return `${personalText} Public leaderboards require an actual 25, 50, 150, or 250-question timed quiz.`;
    }
    return `${personalText} Sign in with Google to submit public timed scores.`;
  }

  const publicResult = await progressStore.submitLeaderboardScore(state.currentBoardKey, score);
  return publicResult.submitted
    ? `${personalText} Public leaderboard updated.`
    : `${personalText} ${publicResult.reason}`;
}

function startTimer() {
  stopTimer();
  state.elapsedMs = 0;
  if (!state.currentSettings?.timed) {
    renderTimer();
    return;
  }

  state.timerStartedAt = performance.now();
  state.timerId = window.setInterval(() => {
    state.elapsedMs = performance.now() - state.timerStartedAt;
    renderTimer();
  }, 100);
  renderTimer();
}

function stopTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }

  if (state.currentSettings?.timed && state.timerStartedAt) {
    state.elapsedMs = performance.now() - state.timerStartedAt;
    state.timerStartedAt = 0;
  }

  renderTimer();
  return state.elapsedMs;
}

function renderTimer() {
  elements.timerDisplay.textContent = state.currentSettings?.timed
    ? formatElapsedTime(state.elapsedMs)
    : "Untimed";
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

function escapeText(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
