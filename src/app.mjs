import { createAudioController } from "./audio.mjs";
import { createProgressStore } from "./auth.mjs";
import {
  buildAutofillSuggestions,
  buildLeaderboardKey,
  buildChoices,
  formatElapsedTime,
  detectInputDeviceClass,
  getAccessGate,
  getAvailableQuestionOptions,
  getFixedLandscapeTransform,
  getGoogleAuthEnvironmentStatus,
  getSpriteUrl,
  isAttemptSubmission,
  isCorrectAnswer,
  isLeaderboardEligible,
  moveMenuCursor,
  resolveQuizSettings,
  shouldTrackPokedexForRun,
  shouldRejectQuizEvent,
  shuffle,
} from "./core.mjs";
import { loadPokemonCatalog } from "./pokemon-api.mjs";

const $ = (selector) => document.querySelector(selector);
const DEVICE_ACCESS_KEY = "pokemonQuiz.deviceAccess.v1";
const QUIZ_EXIT_CONFIRM_MS = 5000;
const ART_TOGGLE_HOLD_MS = 420;

if (location.href.startsWith("file:///android_asset/")) {
  document.documentElement.classList.add("native-app");
}
if (isStandaloneDisplayMode()) {
  document.documentElement.classList.add("standalone-app");
}

const elements = {
  deviceStage: $("#device-stage"),
  appShell: $(".pokedex-device"),
  trainerBadge: $("#trainer-badge"),
  trainerAvatarBadge: $("#trainer-avatar-badge"),
  trainerBadgeName: $("#trainer-badge-name"),
  bootScreen: $("#boot-screen"),
  bootStatus: $("#boot-status"),
  screenClock: $("#screen-clock"),
  lockScreen: $("#device-lock-screen"),
  lockStatus: $("#lock-status"),
  workspace: $("#device-workspace"),
  osSplash: $("#os-splash"),
  osSplashTitle: $("#os-splash-title"),
  osSplashSubtitle: $("#os-splash-subtitle"),
  osMenuButton: $("#os-menu-button"),
  osAccountName: $("#os-account-name"),
  osAccountMethod: $("#os-account-method"),
  guest: $("#guest-button"),
  register: $("#register-button"),
  registerForm: $("#register-form"),
  registerName: $("#register-name"),
  trainerProfileList: $("#trainer-profile-list"),
  authStatus: $("#auth-status"),
  login: $("#login-button"),
  logout: $("#logout-button"),
  catalogStatus: $("#catalog-status"),
  settingsStatus: $("#settings-status"),
  trainerAvatar: $("#trainer-avatar"),
  deviceTheme: $("#device-theme"),
  soundEnabled: $("#sound-enabled"),
  savePreferences: $("#save-preferences-button"),
  setupGeneration: $("#setup-generation"),
  setupQuestions: $("#setup-questions"),
  setupAnswerStyle: $("#setup-answer-style"),
  setupTimed: $("#setup-timed"),
  setupLeaderboard: $("#setup-leaderboard"),
  setupPreview: $("#setup-preview"),
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
  attemptsRemaining: $("#attempts-remaining"),
  timerDisplay: $("#timer-display"),
  art: $("#pokemon-art"),
  artToggle: $("#art-toggle-button"),
  promptTitle: $("#prompt-title"),
  promptDetail: $("#prompt-detail"),
  form: $("#answer-form"),
  input: $("#guess-input"),
  guessButton: $("#guess-button"),
  autofillList: $("#autofill-list"),
  choiceGrid: $("#choice-grid"),
  message: $("#message"),
  next: $("#next-button"),
  restart: $("#restart-button"),
  summaryText: $("#summary-text"),
  summaryRestart: $("#summary-restart-button"),
  viewButtons: [...document.querySelectorAll("[data-view-target]")],
  viewPanels: [...document.querySelectorAll("[data-view]")],
  lcdFullscreenButtons: [...document.querySelectorAll("[data-lcd-fullscreen]")],
  installButtons: [...document.querySelectorAll("[data-install-app]")],
};

const googleAuthEnvironment = getGoogleAuthEnvironmentStatus({
  href: location.href,
  userAgent: navigator.userAgent,
  standalone: isStandaloneDisplayMode(),
});

function getCurrentInputDeviceClass() {
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
  const finePointer = window.matchMedia?.("(pointer: fine)")?.matches;
  return detectInputDeviceClass({
    pointer: coarsePointer ? "coarse" : finePointer ? "fine" : "",
    maxTouchPoints: navigator.maxTouchPoints,
    userAgent: navigator.userAgent,
  });
}

const savedDeviceAccess = readDeviceAccess();
const audio = createAudioController();

const state = {
  catalog: null,
  progress: null,
  activeView: "menu",
  deviceUnlocked: Boolean(savedDeviceAccess),
  deviceAccess: savedDeviceAccess,
  catalogLoading: false,
  rounds: [],
  choices: [],
  pool: [],
  currentSettings: null,
  currentBoardKey: "",
  currentIndex: 0,
  score: 0,
  attemptsRemaining: 3,
  roundResolved: false,
  stagedCorrectIds: [],
  quizRejected: false,
  eligibilitySnapshot: null,
  timerId: null,
  timerStartedAt: 0,
  elapsedMs: 0,
  preferenceKey: "",
  preferencesHydrated: false,
  menuCursorIndex: 0,
  menuExitArmedUntil: 0,
  soundEnabled: audio.enabled,
  bootComplete: false,
  lcdOnlyMode: shouldStartInLcdOnlyMode(),
  quizArtworkSource: "pixel",
  artToggleTimerId: 0,
};

let leaderboardRequestId = 0;
let launchTimerId = 0;
let fitFrameId = 0;
let deferredInstallPrompt = null;

const OS_APP_LABELS = {
  setup: {
    title: "Who's That Pokémon?",
    subtitle: "Opening quiz scanner.",
  },
  dex: {
    title: "PokéDex Log",
    subtitle: "Opening archive records.",
  },
  leaderboard: {
    title: "Ranking",
    subtitle: "Opening timed boards.",
  },
  settings: {
    title: "Option",
    subtitle: "Opening device options.",
  },
};

const progressStore = createProgressStore(
  (progress) => {
    state.progress = progress;
    renderAuth();
    if (isDeviceUnlocked()) void ensureCatalogReady();
    renderDex();
  },
  {
    googleAuthSupported: googleAuthEnvironment.supported,
    googleAuthUnsupportedMessage: googleAuthEnvironment.message,
  },
);

bindEvents();
await init();

function bindEvents() {
  document.addEventListener("pointerdown", primeAudio, { once: true });
  document.addEventListener("keydown", primeAudio, { once: true });
  elements.guest.addEventListener("click", () => {
    playCue("confirm");
    unlockDevice({ type: "guest", label: "Guest trainer" });
  });
  elements.register.addEventListener("click", () => {
    playCue("menu");
    elements.registerForm.classList.toggle("hidden");
    if (!elements.registerForm.classList.contains("hidden")) {
      elements.registerName.focus({ preventScroll: true });
    } else {
      elements.register.focus({ preventScroll: true });
    }
  });
  elements.registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.registerName.value.trim();
    const result = progressStore.createOrLoadLocalTrainer(name);
    if (!result.profile) {
      playCue("deny");
      pulseWorkspace("screen-error");
      setLockStatus(result.error);
      elements.registerName.focus();
      return;
    }

    playCue("confirm");
    elements.registerForm.classList.add("hidden");
    elements.registerName.value = "";
    setLockStatus(
      result.created
        ? `Local account created: ${result.profile.displayName}.`
        : `Local account loaded: ${result.profile.displayName}.`,
    );
    setActiveView("menu");
  });
  elements.login.addEventListener("click", () => {
    if (!googleAuthEnvironment.supported) {
      playCue("deny");
      pulseWorkspace("screen-error");
      setLockStatus(googleAuthEnvironment.message);
      return;
    }

    playCue("launch");
    setLockStatus("Opening Google login...");
    void progressStore.signIn({
      signInFlow: googleAuthEnvironment.signInFlow,
      allowRedirectFallback: googleAuthEnvironment.supported,
      timeoutMs: 30000,
    });
  });
  elements.logout.addEventListener("click", () => {
    playCue("lock");
    lockDevice();
  });
  elements.lcdFullscreenButtons.forEach((button) => {
    button.addEventListener("click", () => {
      playCue("menu");
      void toggleLcdOnlyMode();
    });
  });
  elements.installButtons.forEach((button) => {
    button.addEventListener("click", () => {
      playCue("menu");
      void installMobileApp();
    });
  });
  elements.refreshData.addEventListener("click", () => {
    playCue("scan");
    pulseWorkspace("screen-scan");
    ensureCatalogReady({ forceRefresh: true });
  });
  elements.trainerAvatar.addEventListener("input", () => {
    playCue("menu");
    renderTrainerBadge();
  });
  elements.deviceTheme.addEventListener("input", () => {
    playCue("menu");
    applyDeviceTheme(elements.deviceTheme.value);
    pulseElement(elements.appShell, "shell-pulse");
  });
  elements.soundEnabled.addEventListener("input", () => {
    state.soundEnabled = elements.soundEnabled.checked;
    audio.setEnabled(state.soundEnabled);
    if (state.soundEnabled) playCue("confirm");
  });
  elements.savePreferences.addEventListener("click", saveCurrentTrainerPreferences);
  elements.start.addEventListener("click", startQuiz);
  elements.form.addEventListener("submit", onGuessSubmit);
  elements.input.addEventListener("input", renderAutofillSuggestions);
  elements.input.addEventListener("paste", (event) => void rejectActiveQuiz(event));
  elements.input.addEventListener("drop", (event) => void rejectActiveQuiz(event));
  elements.next.addEventListener("click", nextRound);
  elements.restart.addEventListener("click", requestOsMenu);
  elements.summaryRestart.addEventListener("click", showOsMenu);
  elements.osMenuButton.addEventListener("click", requestOsMenu);
  elements.artToggle.addEventListener("pointerdown", startArtToggleHold);
  elements.artToggle.addEventListener("pointerup", cancelArtToggleHold);
  elements.artToggle.addEventListener("pointercancel", cancelArtToggleHold);
  elements.artToggle.addEventListener("pointerleave", cancelArtToggleHold);
  elements.artToggle.addEventListener("keydown", onArtToggleKeyDown);
  elements.artToggle.addEventListener("keyup", cancelArtToggleHold);
  document.addEventListener("keydown", onGameboyKeyDown);
  window.addEventListener("resize", scheduleFitDeviceToViewport);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(scheduleFitDeviceToViewport, 120);
  });
  window.screen?.orientation?.addEventListener?.("change", () => {
    window.setTimeout(scheduleFitDeviceToViewport, 80);
  });
  window.visualViewport?.addEventListener?.("resize", scheduleFitDeviceToViewport);
  window.visualViewport?.addEventListener?.("scroll", scheduleFitDeviceToViewport);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    setInstallStatus("PokéDex installed.");
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && state.lcdOnlyMode) {
      setLcdOnlyMode(false);
    }
  });
  document.addEventListener("visibilitychange", () => {
    void rejectActiveQuiz({ type: "visibilitychange", hidden: document.hidden });
  });
  window.addEventListener("pagehide", (event) => {
    void rejectActiveQuiz(event);
  });
  window.addEventListener("freeze", (event) => {
    void rejectActiveQuiz(event);
  });

  for (const control of [
    elements.setupGeneration,
    elements.setupQuestions,
    elements.setupAnswerStyle,
    elements.setupTimed,
    elements.setupLeaderboard,
  ]) {
    control.addEventListener("input", () => {
      playCue("menu");
      pulseWorkspace("screen-tick");
      updateSetupPreview();
    });
  }

  elements.viewButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      playCue("select");
      pulseElement(button, "button-pulse");
      setMenuCursor(index);
      launchOsApp(button.dataset.viewTarget);
    });
  });

}

async function init() {
  elements.soundEnabled.checked = state.soundEnabled;
  registerServiceWorker();
  renderAuth();
  setLcdOnlyMode(state.lcdOnlyMode);
  updateDeviceShell();
  await progressStore.init();
  await ensureCatalogReady();
  if (isDeviceUnlocked()) setActiveView(state.activeView);
  completeBoot();
}

async function initCatalog({ forceRefresh = false } = {}) {
  if (!isDeviceUnlocked()) {
    elements.start.disabled = true;
    elements.catalogStatus.textContent = "Log in to PokéOS to load the PokéDex catalog.";
    return;
  }

  state.catalogLoading = true;
  elements.start.disabled = true;
  elements.catalogStatus.textContent = forceRefresh
    ? "Refreshing PokéDex catalog..."
    : "Loading PokéDex catalog...";

  try {
    state.catalog = await loadPokemonCatalog({ forceRefresh });
    populateSetupControls();
    elements.catalogStatus.textContent =
      `Loaded ${state.catalog.pokemon.length} Pokémon across ${state.catalog.generations.length} generations.`;
    updateSetupPreview();
  } catch (error) {
    elements.catalogStatus.textContent = `Catalog load failed: ${error.message}`;
    elements.start.disabled = true;
  } finally {
    state.catalogLoading = false;
  }
}

async function ensureCatalogReady({ forceRefresh = false } = {}) {
  if (!isDeviceUnlocked()) {
    elements.start.disabled = true;
    elements.catalogStatus.textContent = "Log in to PokéOS to load the PokéDex catalog.";
    return;
  }

  if (state.catalogLoading) return;
  if (state.catalog && !forceRefresh) {
    updateSetupPreview();
    return;
  }

  await initCatalog({ forceRefresh });
}

function populateSetupControls() {
  const currentGeneration = elements.setupGeneration.value || "all";
  elements.setupGeneration.replaceChildren(
    option("all", "All Pokémon"),
    ...state.catalog.generations.map((generation) =>
      option(String(generation.id), `${generation.label} (${capitalize(generation.region || "unknown")})`),
    ),
  );
  setSelectValue(elements.setupGeneration, currentGeneration);
  hydrateTrainerPreferences();
}

function updateSetupPreview() {
  if (!state.catalog) return;
  if (!isDeviceUnlocked()) {
    elements.start.disabled = true;
    elements.catalogStatus.textContent = "Log in to PokéOS to load the PokéDex catalog.";
    elements.setupPreview.textContent = "Trainer access is required before quiz setup.";
    return;
  }

  state.pool = getFilteredPool();
  syncQuestionOptions(state.pool.length);
  syncLeaderboardToggle();
  state.currentSettings = getQuizSettings(state.pool.length);
  state.currentBoardKey = buildLeaderboardKey(state.currentSettings);
  elements.start.disabled = state.pool.length === 0 || !isDeviceUnlocked();
  elements.catalogStatus.textContent =
    `${state.pool.length} Pokémon available for this setup.`;
  elements.setupPreview.textContent = getSetupPreviewText(state.currentSettings);
  renderDex();
  void renderLeaderboard();
}

function hydrateTrainerPreferences() {
  const progress = state.progress ?? progressStore.getState();
  const key = getPreferenceKey(progress);
  if (state.preferenceKey !== key) {
    state.preferenceKey = key;
    state.preferencesHydrated = false;
  }

  const preferences = progress.preferences;
  if (!preferences) return;

  elements.trainerAvatar.value = String(preferences.avatarId);
  elements.deviceTheme.value = preferences.themeId;
  applyDeviceTheme(preferences.themeId);
  renderTrainerBadge();

  if (!state.catalog || state.preferencesHydrated) return;

  applyQuizDefaults(preferences.quizDefaults);
  state.preferencesHydrated = true;
}

function applyQuizDefaults(defaults) {
  setSelectValue(elements.setupGeneration, defaults.generation);
  elements.setupAnswerStyle.value = defaults.answerStyle;
  elements.setupTimed.checked = Boolean(defaults.timed);
  elements.setupLeaderboard.checked = Boolean(defaults.leaderboard);
  state.pool = getFilteredPool();
  syncQuestionOptions(state.pool.length, defaults.questions);
  syncLeaderboardToggle();
}

function saveCurrentTrainerPreferences() {
  playCue("save");
  pulseWorkspace("screen-success");
  const preferences = progressStore.updateTrainerPreferences(
    {
      avatarId: Number(elements.trainerAvatar.value),
      themeId: elements.deviceTheme.value,
      quizDefaults: getQuizSettings(state.pool.length || state.catalog?.pokemon.length || 1025),
    },
    { poolSize: state.pool.length || state.catalog?.pokemon.length || 1025 },
  );
  state.preferencesHydrated = true;
  applyDeviceTheme(preferences.themeId);
  renderTrainerBadge();
  elements.settingsStatus.textContent = "Trainer defaults saved for this profile.";
  updateSetupPreview();
}

function getFilteredPool() {
  const generation = elements.setupGeneration.value;
  if (!generation || generation === "all") return [...state.catalog.pokemon];
  return state.catalog.pokemon.filter((pokemon) => String(pokemon.generationId) === generation);
}

function getQuizSettings(poolSize = state.pool.length) {
  return resolveQuizSettings({
    generation: elements.setupGeneration.value,
    questions: elements.setupQuestions.value,
    answerStyle: elements.setupAnswerStyle.value,
    timed: elements.setupTimed.checked,
    leaderboard: elements.setupLeaderboard.checked,
    poolSize,
    inputDevice: getCurrentInputDeviceClass(),
  });
}

function syncQuestionOptions(poolSize, preferredValue = elements.setupQuestions.value) {
  const options = getAvailableQuestionOptions({
    generation: elements.setupGeneration.value,
    poolSize,
  });
  const fallback = options.find((candidate) => !candidate.disabled)?.value ?? "all-pokemon";
  const selectedValue = options.some((candidate) => candidate.value === preferredValue)
    ? preferredValue
    : fallback;

  elements.setupQuestions.replaceChildren(
    ...options.map((candidate) => {
      const element = option(candidate.value, candidate.label);
      element.disabled = candidate.disabled;
      element.dataset.publicEligible = String(candidate.publicEligible);
      return element;
    }),
  );
  elements.setupQuestions.value = selectedValue;
}

function syncLeaderboardToggle() {
  const settings = resolveQuizSettings({
    generation: elements.setupGeneration.value,
    questions: elements.setupQuestions.value,
    answerStyle: elements.setupAnswerStyle.value,
    timed: elements.setupTimed.checked,
    leaderboard: elements.setupLeaderboard.checked,
    poolSize: state.pool.length,
  });
  const enabled = settings.timed && settings.publicEligiblePreset;
  elements.setupLeaderboard.disabled = !enabled;
  if (!enabled) elements.setupLeaderboard.checked = false;
}

function getSetupPreviewText(settings) {
  const progress = state.progress ?? progressStore.getState();
  const answerLabel = settings.answerStyle === "choice" ? "Multiple choice" : "Typed";
  const generationLabel = getGenerationLabel(settings.generation);
  const questionLabel = getQuestionLabel(settings);
  const timerText = settings.timed ? "Timed stopwatch run" : "Casual untimed run";

  let submitText = "No timed bests or public leaderboard placement.";
  if (settings.timed && !settings.publicEligiblePreset) {
    submitText = "Personal best only. All Pokémon runs do not submit to public boards.";
  } else if (settings.timed && !settings.leaderboard) {
    submitText = "Personal best only. Leaderboard submission is off.";
  } else if (settings.timed && progress.user?.provider === "google") {
    submitText = "Public leaderboard eligible after completion.";
  } else if (settings.timed && settings.leaderboard) {
    submitText = "Google Auth required for public submission; this run saves personal best only unless signed in.";
  }

  return `${generationLabel}. ${questionLabel}. ${answerLabel}. ${timerText}. ${submitText}`;
}

function startQuiz() {
  if (!isDeviceUnlocked()) {
    playCue("deny");
    pulseWorkspace("screen-error");
    setLockStatus("Trainer access is required before scanner initialization.");
    updateDeviceShell();
    return;
  }
  if (!state.catalog) {
    void ensureCatalogReady();
    return;
  }

  state.pool = getFilteredPool();
  syncQuestionOptions(state.pool.length);
  syncLeaderboardToggle();
  state.currentSettings = getQuizSettings(state.pool.length);
  state.currentBoardKey = buildLeaderboardKey(state.currentSettings);
  const length = state.currentSettings.length;
  if (length < 1) {
    playCue("deny");
    pulseWorkspace("screen-error");
    setMessage("No Pokémon are available for this setup.", "wrong");
    return;
  }

  playCue("start");
  pulseWorkspace("screen-scan");
  state.rounds = shuffle(state.pool).slice(0, length);
  state.currentIndex = 0;
  state.score = 0;
  state.attemptsRemaining = 3;
  state.roundResolved = false;
  state.stagedCorrectIds = [];
  state.quizRejected = false;
  state.menuExitArmedUntil = 0;
  state.eligibilitySnapshot = createEligibilitySnapshot();
  state.activeView = "quiz";
  hideViewPanels();
  elements.viewButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewTarget === "setup"));
  });
  const quizMenuIndex = elements.viewButtons.findIndex((button) => button.dataset.viewTarget === "setup");
  setMenuCursor(quizMenuIndex);
  elements.summaryPanel.classList.add("hidden");
  elements.quizPanel.classList.remove("hidden");
  renderRound();
  startTimer();
  updateOsMenuButton();
}

function requestOsMenu() {
  if (!isQuizActive()) {
    playCue("menu");
    showOsMenu();
    return;
  }

  const now = Date.now();
  if (state.menuExitArmedUntil > now) {
    playCue("close");
    state.menuExitArmedUntil = 0;
    showOsMenu();
    return;
  }

  playCue("quit");
  pulseWorkspace("screen-warn");
  state.menuExitArmedUntil = now + QUIZ_EXIT_CONFIRM_MS;
  updateOsMenuButton();
  window.setTimeout(() => {
    if (state.menuExitArmedUntil && Date.now() >= state.menuExitArmedUntil) {
      state.menuExitArmedUntil = 0;
      updateOsMenuButton();
    }
  }, QUIZ_EXIT_CONFIRM_MS + 80);
}

function showOsMenu() {
  pulseWorkspace("screen-tick");
  stopTimer();
  resetQuizRunState();
  elements.quizPanel.classList.add("hidden");
  elements.summaryPanel.classList.add("hidden");
  elements.message.textContent = "";
  elements.autofillList.replaceChildren();
  renderTimer();
  setActiveView("menu", { focusMenu: true });
  updateOsMenuButton();
}

function renderRound() {
  const pokemon = getCurrentPokemon();
  const roundNumber = state.currentIndex + 1;

  state.roundResolved = false;
  state.attemptsRemaining = 3;
  state.menuExitArmedUntil = 0;
  state.choices = [];
  pulseWorkspace("screen-scan");
  elements.art.alt = "Pokémon silhouette quiz prompt";
  renderQuizArtwork();
  elements.roundCount.textContent = `${roundNumber}/${state.rounds.length}`;
  elements.score.textContent = String(state.score);
  elements.attemptsRemaining.textContent = String(state.attemptsRemaining);
  renderTimer();
  elements.promptTitle.textContent = "Who's That Pokémon?";
  elements.promptDetail.textContent = "Name the silhouette before your three attempts run out.";
  elements.input.value = "";
  elements.input.disabled = false;
  elements.guessButton.disabled = false;
  elements.next.classList.add("hidden");
  elements.autofillList.replaceChildren();
  elements.message.textContent = "";
  elements.message.className = "message";
  updateOsMenuButton();

  if (state.currentSettings.answerStyle === "choice") {
    renderChoices();
  } else {
    elements.form.classList.remove("hidden");
    elements.choiceGrid.classList.add("hidden");
    elements.input.placeholder = "Example: Pikachu";
    elements.input.focus();
  }
}

function renderChoices() {
  const pokemon = getCurrentPokemon();
  state.choices = buildChoices({
    current: pokemon,
    pool: state.pool,
    mode: "name",
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

function renderAutofillSuggestions() {
  if (
    state.quizRejected ||
    state.roundResolved ||
    state.currentSettings?.answerStyle !== "typed"
  ) {
    elements.autofillList.replaceChildren();
    return;
  }

  const suggestions = buildAutofillSuggestions(elements.input.value, state.pool, { limit: 3 });
  elements.autofillList.replaceChildren(
    ...suggestions.map((suggestion) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = suggestion.label;
      button.addEventListener("click", () => {
        playCue("select");
        pulseElement(button, "button-pulse");
        elements.input.value = suggestion.value;
        elements.autofillList.replaceChildren();
        elements.input.focus();
      });
      return button;
    }),
  );
}

function onGuessSubmit(event) {
  event.preventDefault();
  if (state.roundResolved || state.quizRejected) return;
  if (!isAttemptSubmission(elements.input.value)) {
    playCue("deny");
    pulseWorkspace("screen-error");
    setMessage("Enter a Pokémon name before guessing.", "wrong");
    return;
  }

  const pokemon = getCurrentPokemon();
  const correct = isCorrectAnswer(
    elements.input.value,
    pokemon,
    "name",
    state.catalog.pokemon,
  );

  if (!correct) {
    playCue("wrong");
    consumeAttempt(`No match for "${elements.input.value.trim()}".`);
    return;
  }

  handleCorrect();
}

function onChoice(choice, button) {
  if (state.roundResolved || state.quizRejected || button.disabled) return;
  const pokemon = getCurrentPokemon();
  const correct = choice.correct || isCorrectAnswer(choice.value, pokemon, "name", state.catalog.pokemon);
  button.classList.add(correct ? "correct" : "wrong");
  if (!correct) {
    playCue("wrong");
    button.disabled = true;
    consumeAttempt("No match. Try another choice.");
    return;
  }

  handleCorrect();
}

function handleCorrect() {
  const pokemon = getCurrentPokemon();
  playCue("correct");
  pulseWorkspace("screen-success");
  state.score += 1;
  state.roundResolved = true;
  if (
    shouldTrackPokedexForRun(state.currentSettings) &&
    !state.stagedCorrectIds.includes(pokemon.id)
  ) {
    state.stagedCorrectIds.push(pokemon.id);
  }
  elements.score.textContent = String(state.score);
  pauseTimer();
  revealPokemon(`Correct. ${getRevealText(pokemon)}`, "correct");
}

async function commitStagedProgress() {
  if (!shouldTrackPokedexForRun(state.currentSettings)) return;
  const ids = [...new Set(state.stagedCorrectIds)];
  for (const id of ids) {
    await progressStore.recordCorrectPokemon(id);
  }
}

function createEligibilitySnapshot() {
  const progress = state.progress ?? progressStore.getState();
  const trainer = getCurrentTrainerIdentity(progress);
  return {
    trainer,
    publicEligible: isLeaderboardEligible(state.currentSettings, progress.user),
  };
}

function resetQuizRunState() {
  state.rounds = [];
  state.choices = [];
  state.currentIndex = 0;
  state.score = 0;
  state.attemptsRemaining = 3;
  state.roundResolved = false;
  state.stagedCorrectIds = [];
  state.quizRejected = false;
  state.menuExitArmedUntil = 0;
  state.quizArtworkSource = "pixel";
  cancelArtToggleHold();
  state.eligibilitySnapshot = null;
}

async function rejectActiveQuiz(event) {
  if (!isQuizActive() || !shouldRejectQuizEvent(event)) return;
  event?.preventDefault?.();
  playCue("lock");
  pulseWorkspace("screen-error");
  state.quizRejected = true;
  state.menuExitArmedUntil = 0;
  stopTimer();
  state.stagedCorrectIds = [];
  sessionStorage.removeItem(DEVICE_ACCESS_KEY);
  state.deviceUnlocked = false;
  state.deviceAccess = null;
  elements.quizPanel.classList.add("hidden");
  elements.summaryPanel.classList.add("hidden");
  elements.autofillList.replaceChildren();
  setLockStatus("Run closed. Session locked.");
  await progressStore.closeActiveSessionAfterRejectedQuiz("Run closed. Session locked.");
  updateDeviceShell();
  updateOsMenuButton();
}

function isQuizActive() {
  return !elements.quizPanel.classList.contains("hidden") && state.rounds.length > 0 && !state.quizRejected;
}

function consumeAttempt(message) {
  state.attemptsRemaining = Math.max(0, state.attemptsRemaining - 1);
  elements.attemptsRemaining.textContent = String(state.attemptsRemaining);
  elements.input.value = "";
  elements.autofillList.replaceChildren();

  if (state.attemptsRemaining > 0) {
    pulseWorkspace("screen-wrong");
    setMessage(`${message} ${state.attemptsRemaining} attempts remaining.`, "wrong");
    return;
  }

  failCurrentRound();
}

function failCurrentRound() {
  playCue("deny");
  pulseWorkspace("screen-error");
  state.roundResolved = true;
  elements.input.disabled = true;
  elements.guessButton.disabled = true;
  elements.autofillList.replaceChildren();
  elements.choiceGrid.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  elements.next.classList.remove("hidden");
  setMessage("No attempts remaining. This Pokémon stays unlogged.", "wrong");
}

function revealPokemon(message, tone) {
  renderQuizArtwork();
  pulseElement(elements.art, "sprite-reveal");
  elements.input.disabled = true;
  elements.guessButton.disabled = true;
  elements.autofillList.replaceChildren();
  elements.next.classList.remove("hidden");
  elements.choiceGrid.querySelectorAll("button").forEach((button) => {
    const correct = state.choices.find((choice) => choice.value === button.dataset.value)?.correct;
    if (correct) button.classList.add("correct");
    button.disabled = true;
  });
  setMessage(message, tone);
}

function nextRound() {
  playCue("next");
  if (state.currentIndex + 1 >= state.rounds.length) {
    void finishQuiz();
    return;
  }

  state.currentIndex += 1;
  renderRound();
  resumeTimer();
}

async function finishQuiz() {
  const elapsedMs = stopTimer();
  if (state.quizRejected) return;
  playCue("complete");
  pulseWorkspace("screen-success");
  await commitStagedProgress();
  const percent = Math.round((state.score / state.rounds.length) * 100);
  state.activeView = "summary";
  elements.quizPanel.classList.add("hidden");
  hideViewPanels();
  elements.summaryPanel.classList.remove("hidden");
  elements.viewButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewTarget === "setup"));
  });
  const scoreResult = await recordTimedScore(elapsedMs);
  elements.summaryText.textContent = [
    `You scored ${state.score} of ${state.rounds.length} (${percent}%).`,
    state.currentSettings.timed ? `Time: ${formatElapsedTime(elapsedMs)}.` : "",
    scoreResult,
    !state.currentSettings.timed ? "Casual runs do not update the PokéDex log." : "",
    state.stagedCorrectIds.length ? "Correct guesses were added to your PokéDex." : "",
  ].filter(Boolean).join(" ");
  renderDex();
  await renderLeaderboard();
}

function renderAuth() {
  const progress = state.progress ?? progressStore.getState();
  const wasUnlocked = Boolean(state.deviceUnlocked);
  if (progress.user) {
    state.deviceUnlocked = true;
    state.deviceAccess = { type: "google", label: progress.user.displayName || "Google trainer" };
  } else if (progress.localTrainer) {
    state.deviceUnlocked = true;
    state.deviceAccess = {
      type: "registered",
      label: progress.localTrainer.displayName,
      id: progress.localTrainer.id,
    };
  } else if (state.deviceAccess?.type === "google" || state.deviceAccess?.type === "registered") {
    state.deviceUnlocked = false;
    state.deviceAccess = null;
  }

  const gate = getDeviceGate(progress);
  state.deviceUnlocked = !gate.locked;
  elements.authStatus.textContent = getHardwareStatusText(progress);
  elements.login.disabled =
    !progress.authAvailable ||
    progress.authPending ||
    (!googleAuthEnvironment.supported && !progress.user);
  elements.login.title = googleAuthEnvironment.supported ? "" : googleAuthEnvironment.message;
  elements.login.classList.toggle("hidden", Boolean(progress.user));
  elements.logout.classList.toggle("hidden", gate.locked);
  if (gate.locked && !state.deviceAccess) {
    elements.lockStatus.textContent = getLockStatusText(progress);
  }
  renderLocalTrainerProfiles(progress);
  hydrateTrainerPreferences();
  renderTrainerBadge();
  renderOsAccount(progress);
  updateDeviceShell();
  if (!gate.locked && !wasUnlocked && state.bootComplete) {
    setActiveView("menu", { focusMenu: true });
  }
}

function renderTrainerBadge(progress = state.progress ?? progressStore.getState()) {
  const identity = getCurrentTrainerIdentity(progress);
  const preferences = progress.preferences ?? progressStore.getState().preferences;
  const avatarId = Number(elements.trainerAvatar?.value || preferences?.avatarId || 25);
  const avatarLabel = String(avatarId).padStart(3, "0");
  elements.trainerAvatarBadge.textContent = avatarLabel;
  elements.trainerBadgeName.textContent = identity?.displayName ?? "Locked";
}

function applyDeviceTheme(themeId = "classic") {
  elements.appShell.dataset.deviceTheme = themeId;
}

function renderLocalTrainerProfiles(progress) {
  const profiles = progress.localTrainers ?? [];
  if (!profiles.length) {
    elements.trainerProfileList.replaceChildren();
    return;
  }

  const heading = document.createElement("p");
  heading.className = "local-trainer-heading";
  heading.textContent = "Local Accounts";

  elements.trainerProfileList.replaceChildren(
    heading,
    ...profiles.map((profile) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = profile.displayName;
      button.addEventListener("click", () => {
        const result = progressStore.selectLocalTrainer(profile.id);
        if (!result.selected) {
          setLockStatus("Local account was not found.");
          return;
        }

        setLockStatus(`Local account loaded: ${result.profile.displayName}.`);
        setActiveView("menu", { focusMenu: true });
      });
      return button;
    }),
  );
}

function renderDex() {
  if (!isDeviceUnlocked()) return;
  if (!state.catalog) return;
  const caughtIds = new Set((state.progress ?? progressStore.getState()).correctPokemonIds);
  const filtered = state.pool.length ? state.pool : getFilteredPool();
  const caughtTotal = caughtIds.size;
  const caughtInFilter = filtered.filter((pokemon) => caughtIds.has(pokemon.id)).length;
  const allTotal = state.catalog.pokemon.length;
  const percent = allTotal ? Math.round((caughtTotal / allTotal) * 100) : 0;

  elements.dexSummary.textContent =
    `${caughtTotal}/${allTotal} total caught. ${caughtInFilter}/${filtered.length} in current setup.`;
  elements.dexFill.style.width = `${percent}%`;
  elements.dexList.replaceChildren(
    ...filtered.slice(0, 300).map((pokemon) => renderDexEntry(pokemon, caughtIds.has(pokemon.id))),
  );
}

async function renderLeaderboard() {
  if (!isDeviceUnlocked()) return;
  if (!state.catalog) return;

  const requestId = ++leaderboardRequestId;
  const settings = getQuizSettings(state.pool.length || getFilteredPool().length);
  const boardKey = buildLeaderboardKey(settings);
  const progress = state.progress ?? progressStore.getState();
  const personalBest = progress.personalScores?.[boardKey];

  if (!settings.timed) {
    elements.leaderboardSummary.textContent = "Timed mode is off. Casual runs do not save timed bests or public scores.";
    renderLeaderboardRows([]);
    return;
  }

  if (!settings.publicEligiblePreset) {
    elements.leaderboardSummary.textContent = personalBest
      ? `Personal best: ${personalBest.correct}/${personalBest.total} in ${formatElapsedTime(personalBest.elapsedMs)}.`
      : "This timed setup saves personal bests only.";
    renderLeaderboardRows([]);
    return;
  }

  if (!settings.leaderboard) {
    elements.leaderboardSummary.textContent = personalBest
      ? `Leaderboard is off. Personal best: ${personalBest.correct}/${personalBest.total} in ${formatElapsedTime(personalBest.elapsedMs)}.`
      : "Leaderboard is off. Timed runs will save personal bests only.";
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
  const snapshot = state.eligibilitySnapshot ?? createEligibilitySnapshot();
  const trainer = snapshot.trainer ?? getCurrentTrainerIdentity(progress);
  const score = {
    boardKey: state.currentBoardKey,
    uid: trainer?.uid ?? "guest",
    displayName: trainer?.displayName ?? "Guest",
    correct: state.score,
    total: state.rounds.length,
    elapsedMs,
    accuracy: state.rounds.length ? state.score / state.rounds.length : 0,
    settings: state.currentSettings,
    leaderboard: state.currentSettings.leaderboard,
    rejected: false,
    completedAt: new Date().toISOString(),
  };

  const personal = await progressStore.recordPersonalScore(state.currentBoardKey, score);
  const personalText = personal.saved ? "New personal best saved." : "Personal best unchanged.";

  if (!snapshot.publicEligible) {
    if (!state.currentSettings.publicEligiblePreset) {
      return `${personalText} This setup is personal-best only.`;
    }
    if (!state.currentSettings.leaderboard) {
      return `${personalText} Leaderboard submission was off for this run.`;
    }
    return `${personalText} Sign in with Google before starting to submit public timed scores.`;
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
    state.elapsedMs += performance.now() - state.timerStartedAt;
    state.timerStartedAt = performance.now();
    renderTimer();
  }, 100);
  renderTimer();
}

function pauseTimer() {
  if (!state.currentSettings?.timed || !state.timerId) return;
  window.clearInterval(state.timerId);
  state.timerId = null;
  state.elapsedMs += performance.now() - state.timerStartedAt;
  state.timerStartedAt = 0;
  renderTimer();
}

function resumeTimer() {
  if (!state.currentSettings?.timed || state.timerId || state.quizRejected) return;
  state.timerStartedAt = performance.now();
  state.timerId = window.setInterval(() => {
    state.elapsedMs += performance.now() - state.timerStartedAt;
    state.timerStartedAt = performance.now();
    renderTimer();
  }, 100);
  renderTimer();
}

function stopTimer() {
  if (state.timerId) {
    if (state.currentSettings?.timed && state.timerStartedAt) {
      state.elapsedMs += performance.now() - state.timerStartedAt;
    }
    window.clearInterval(state.timerId);
    state.timerId = null;
  }

  state.timerStartedAt = 0;

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
  const typeText = pokemon.types.map(capitalize).join(" / ") || "Unknown";
  const abilityText = formatAbilityList(pokemon.abilities);
  const measurementText = formatMeasurements(pokemon);
  const description = pokemon.description || pokemon.flavorText || pokemon.pokedexEntry || "No field entry available.";
  const category = pokemon.category || pokemon.genus || "Unclassified";
  row.innerHTML = `
    <img src="${escapeText(getPokemonArtworkUrl(pokemon))}" alt="" loading="lazy" />
    <div class="dex-entry-main">
      <strong>#${String(pokemon.id).padStart(3, "0")} ${escapeText(pokemon.displayName)}</strong>
      <span>${escapeText(category)} - ${escapeText(pokemon.generationLabel)}</span>
      <p>${escapeText(description)}</p>
    </div>
    <div class="dex-entry-meta">
      <span>${escapeText(typeText)}</span>
      <span>${escapeText(measurementText)}</span>
      <span>${escapeText(abilityText)}</span>
      <span>${caught ? "Logged" : "Unconfirmed"}</span>
    </div>
  `;
  return row;
}

function getGenerationLabel(generation) {
  if (generation === "all") return "All available Pokémon";
  const entry = state.catalog?.generations.find((candidate) => String(candidate.id) === String(generation));
  if (!entry) return `Generation ${generation}`;
  return `${entry.label} (${capitalize(entry.region || "unknown")})`;
}

function getQuestionLabel(settings) {
  if (settings.questionToken === "all-pokemon") return `${settings.length} Pokémon`;
  if (settings.questionToken === "entire-generation") return `Entire generation (${settings.length})`;
  return `${settings.length} questions`;
}

function getRevealText(pokemon) {
  return `${pokemon.displayName} is #${String(pokemon.id).padStart(3, "0")} from ${pokemon.generationLabel}.`;
}

function getPokemonArtworkUrl(pokemon) {
  return pokemon.sprites?.frontDefault || pokemon.spriteUrl || getSpriteUrl(pokemon.id) || pokemon.artworkUrl;
}

function getPokemonOfficialArtworkUrl(pokemon) {
  return pokemon.artworkUrl || pokemon.sprites?.officialArtwork || pokemon.spriteUrl || getSpriteUrl(pokemon.id);
}

function renderQuizArtwork() {
  const pokemon = getCurrentPokemon();
  if (!pokemon) return;
  const official = state.quizArtworkSource === "official";
  elements.art.src = official ? getPokemonOfficialArtworkUrl(pokemon) : getPokemonArtworkUrl(pokemon);
  elements.art.className = [
    state.roundResolved ? "" : "silhouette",
    official ? "art-source-official" : "art-source-pixel",
  ].filter(Boolean).join(" ");
  elements.artToggle.textContent = official ? "Official" : "Pixel";
  elements.artToggle.setAttribute("aria-pressed", String(official));
  elements.artToggle.setAttribute(
    "aria-label",
    official ? "Hold to switch silhouette to pixel sprite" : "Hold to switch silhouette to official artwork",
  );
}

function startArtToggleHold(event) {
  if (!isQuizActive() || state.artToggleTimerId) return;
  event?.preventDefault?.();
  primeAudio();
  elements.artToggle.classList.add("holding");
  if (event?.pointerId !== undefined) {
    elements.artToggle.setPointerCapture?.(event.pointerId);
  }
  state.artToggleTimerId = window.setTimeout(() => {
    state.artToggleTimerId = 0;
    elements.artToggle.classList.remove("holding");
    toggleQuizArtworkSource();
  }, ART_TOGGLE_HOLD_MS);
}

function onArtToggleKeyDown(event) {
  if (event.key !== " " && event.key !== "Enter") return;
  startArtToggleHold(event);
}

function cancelArtToggleHold() {
  if (state.artToggleTimerId) {
    window.clearTimeout(state.artToggleTimerId);
    state.artToggleTimerId = 0;
  }
  elements.artToggle?.classList.remove("holding");
}

function toggleQuizArtworkSource() {
  if (!isQuizActive()) return;
  state.quizArtworkSource = state.quizArtworkSource === "pixel" ? "official" : "pixel";
  playCue("menu");
  pulseElement(elements.artToggle, "button-pulse");
  renderQuizArtwork();
}

function getCurrentPokemon() {
  return state.rounds[state.currentIndex];
}

function setMessage(text, tone = "") {
  elements.message.textContent = text;
  elements.message.className = `message ${tone}`.trim();
}

function primeAudio() {
  return audio.prime();
}

function playCue(name) {
  audio.play(name);
}

function pulseWorkspace(className) {
  pulseElement(elements.workspace, className);
}

function pulseElement(element, className) {
  if (!element || !className) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => {
    element.classList.remove(className);
  }, 520);
}

function launchOsApp(viewName) {
  const target = OS_APP_LABELS[viewName];
  if (!target) return;

  window.clearTimeout(launchTimerId);
  state.activeView = "launching";
  elements.quizPanel.classList.add("hidden");
  elements.summaryPanel.classList.add("hidden");
  elements.workspace.dataset.osState = "launching";
  elements.workspace.dataset.launchTarget = viewName;
  pulseWorkspace("screen-launch");
  elements.viewPanels.forEach((panel) => panel.classList.add("hidden"));
  updateOsSplash(target.title, target.subtitle);
  elements.viewButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewTarget === viewName));
  });

  launchTimerId = window.setTimeout(() => {
    setActiveView(viewName);
  }, 360);
}

function setActiveView(viewName, { focusMenu = false } = {}) {
  window.clearTimeout(launchTimerId);
  state.activeView = viewName;
  elements.quizPanel.classList.add("hidden");
  elements.summaryPanel.classList.add("hidden");
  elements.workspace.dataset.osState = viewName === "menu" ? "menu" : "app";
  if (viewName === "menu") {
    elements.workspace.dataset.launchTarget = "";
  }
  elements.viewPanels.forEach((panel) => {
    panel.classList.toggle("hidden", viewName === "menu" || panel.dataset.view !== viewName);
  });
  elements.viewButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewTarget === viewName));
  });
  const activeIndex = viewName === "menu"
    ? state.menuCursorIndex
    : elements.viewButtons.findIndex((button) => button.dataset.viewTarget === viewName);
  if (activeIndex >= 0) setMenuCursor(activeIndex, { focus: focusMenu });

  if (viewName === "dex") renderDex();
  if (viewName === "leaderboard") void renderLeaderboard();
  updateOsMenuButton();
}

function updateOsSplash(title, subtitle) {
  elements.osSplashTitle.textContent = title;
  elements.osSplashSubtitle.textContent = subtitle;
  elements.osSplash.classList.remove("os-splash-animate");
  void elements.osSplash.offsetWidth;
  elements.osSplash.classList.add("os-splash-animate");
}

function hideViewPanels() {
  elements.viewPanels.forEach((panel) => panel.classList.add("hidden"));
}

function updateOsMenuButton() {
  if (!elements.osMenuButton) return;
  const quizActive = isQuizActive();
  const confirmingQuit = state.menuExitArmedUntil > Date.now();
  const label = quizActive ? (confirmingQuit ? "QUIT?" : "QUIT") : "MENU";
  elements.osMenuButton.textContent = label;
  elements.osMenuButton.setAttribute(
    "aria-label",
    quizActive ? "Quit current quiz" : "Return to PokéOS command menu",
  );
  if (elements.restart) {
    elements.restart.textContent = label;
    elements.restart.setAttribute("aria-label", quizActive ? "Quit current quiz" : "Return to PokéOS command menu");
  }
}

function onGameboyKeyDown(event) {
  if (isFormField(event.target) && event.key !== "Escape") return;
  if (!isDeviceUnlocked()) {
    if (event.key === "Escape") {
      elements.registerForm.classList.add("hidden");
      elements.registerName.blur();
    }
    return;
  }

  if (state.activeView === "menu" && ["ArrowDown", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    moveGameboyMenu("next");
    return;
  }

  if (state.activeView === "menu" && ["ArrowUp", "ArrowLeft"].includes(event.key)) {
    event.preventDefault();
    moveGameboyMenu("previous");
    return;
  }

  if (state.activeView === "menu" && (event.key === "Enter" || event.key === " ")) {
    const activeElement = document.activeElement;
    const focusedControl =
      activeElement instanceof HTMLButtonElement ||
      activeElement instanceof HTMLAnchorElement;
    if (focusedControl && !activeElement.closest(".main-menu")) return;

    event.preventDefault();
    activateGameboyMenu();
    return;
  }

  if (event.key === "Escape" || event.key === "Backspace") {
    if (state.activeView === "menu") return;
    event.preventDefault();
    requestOsMenu();
  }
}

function moveGameboyMenu(direction) {
  if (state.activeView !== "menu") {
    playCue("deny");
    pulseWorkspace("screen-warn");
    return;
  }
  const buttons = getMenuButtons();
  const nextIndex = moveMenuCursor(state.menuCursorIndex, direction, buttons.length);
  playCue("cursor");
  setMenuCursor(nextIndex, { focus: true });
}

function activateGameboyMenu() {
  if (state.activeView !== "menu") {
    playCue("deny");
    pulseWorkspace("screen-warn");
    return;
  }

  const menuButton = getActiveMenuButton();
  if (!menuButton) return;
  playCue("select");
  pulseElement(menuButton, "button-pulse");
  menuButton.click();
}

function getActiveMenuButton() {
  return getMenuButtons()[state.menuCursorIndex] ?? null;
}

function getMenuButtons() {
  return elements.viewButtons.filter((button) => !button.disabled && !button.hidden);
}

function setMenuCursor(index, { focus = false } = {}) {
  const buttons = getMenuButtons();
  if (!buttons.length) {
    state.menuCursorIndex = -1;
    return;
  }

  state.menuCursorIndex = Math.min(Math.max(Number(index) || 0, 0), buttons.length - 1);
  buttons.forEach((button, buttonIndex) => {
    const selected = buttonIndex === state.menuCursorIndex;
    button.classList.toggle("menu-cursor", selected);
    if (selected && state.activeView === "menu") {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  if (focus) buttons[state.menuCursorIndex].focus({ preventScroll: true });
}

function unlockDevice(access) {
  state.deviceUnlocked = true;
  state.deviceAccess = normalizeDeviceAccess(access);
  writeDeviceAccess(state.deviceAccess);
  setLockStatus(`Access granted: ${state.deviceAccess.label}.`);
  renderAuth();
  updateDeviceShell();
  void ensureCatalogReady();
  setActiveView("menu");
}

function lockDevice() {
  const progress = state.progress ?? progressStore.getState();
  sessionStorage.removeItem(DEVICE_ACCESS_KEY);
  state.deviceUnlocked = false;
  state.deviceAccess = null;
  if (progress.user) void progressStore.signOut();
  if (progress.localTrainer) progressStore.clearLocalTrainer();
  showOsMenu();
  updateDeviceShell();
  updateSetupPreview();
}

function updateDeviceShell() {
  const progress = state.progress ?? progressStore.getState();
  const unlocked = isDeviceUnlocked();
  elements.authStatus.textContent = getHardwareStatusText(progress);
  elements.appShell.dataset.deviceLocked = String(!unlocked);
  elements.workspace.classList.toggle("hidden", !unlocked);
  elements.lockScreen.classList.toggle("hidden", unlocked);
  elements.screenClock.textContent = state.bootComplete ? (unlocked ? "ONLINE" : "LOCKED") : "BOOT";
  elements.logout.classList.toggle("hidden", !unlocked);
  renderOsAccount(progress);
  updateLcdFullscreenButtons();
  fitDeviceToViewport();
}

function fitDeviceToViewport() {
  if (!elements.deviceStage || !elements.appShell) return;

  elements.deviceStage.classList.add("fit-device");
  const viewport = getViewportSize();
  const safeArea = getSafeAreaInsets();
  const rotation = getShellRotation(viewport);
  elements.appShell.style.setProperty("--device-rotation", `${rotation}deg`);

  if (state.lcdOnlyMode) {
    const shellWidth = Math.max(viewport.width, viewport.height);
    const shellHeight = Math.min(viewport.width, viewport.height);
    const transform = getFixedLandscapeTransform({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      rotation,
      shellWidth,
      shellHeight,
      ...safeArea,
    });
    elements.appShell.style.setProperty("--lcd-shell-width", `${shellWidth}px`);
    elements.appShell.style.setProperty("--lcd-shell-height", `${shellHeight}px`);
    elements.appShell.style.setProperty("--device-scale", String(transform.scale));
    elements.appShell.style.setProperty("--device-offset-x", `${transform.offsetX}px`);
    elements.appShell.style.setProperty("--device-offset-y", `${transform.offsetY}px`);
    elements.deviceStage.style.setProperty("--fitted-device-height", `${transform.stageHeight}px`);
    return;
  }

  elements.appShell.style.setProperty("--device-scale", "1");
  elements.appShell.style.setProperty("--device-offset-x", "0px");
  elements.appShell.style.setProperty("--device-offset-y", "0px");
  elements.appShell.style.setProperty("--lcd-shell-width", "");
  elements.appShell.style.setProperty("--lcd-shell-height", "");
  elements.appShell.style.setProperty("--device-rotation", "0deg");
  const rect = elements.appShell.getBoundingClientRect();
  elements.appShell.style.setProperty("--device-rotation", `${rotation}deg`);
  const transform = getFixedLandscapeTransform({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    shellWidth: rect.width,
    shellHeight: rect.height,
    rotation,
    ...safeArea,
  });

  elements.appShell.style.setProperty("--device-scale", String(transform.scale));
  elements.appShell.style.setProperty("--device-offset-x", `${transform.offsetX}px`);
  elements.appShell.style.setProperty("--device-offset-y", `${transform.offsetY}px`);
  elements.deviceStage.style.setProperty("--fitted-device-height", `${transform.stageHeight}px`);
}

function scheduleFitDeviceToViewport() {
  if (fitFrameId) return;
  const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
  fitFrameId = requestFrame(() => {
    fitFrameId = 0;
    fitDeviceToViewport();
  });
}

function getShellRotation(viewport = getViewportSize()) {
  if (!shouldUseFixedLandscapeRotation(viewport)) return 0;
  if (viewport.height <= viewport.width) return 0;
  const angle = getViewportOrientationAngle();
  return angle === 180 || angle === 270 ? -90 : 90;
}

function shouldUseFixedLandscapeRotation(viewport = getViewportSize()) {
  return Boolean(
    document.documentElement.classList.contains("native-app") ||
      isStandaloneDisplayMode() ||
      isMobileAppViewport(viewport),
  );
}

function getViewportSize() {
  return {
    width: Math.max(1, Math.round(window.visualViewport?.width || window.innerWidth || 1)),
    height: Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight || 1)),
  };
}

function isStandaloneDisplayMode() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
    window.navigator?.standalone,
  );
}

function shouldStartInLcdOnlyMode() {
  const viewport = getViewportSize();
  return Boolean(isStandaloneDisplayMode() || isMobileAppViewport(viewport));
}

function isMobileAppViewport(viewport = getViewportSize()) {
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
  const mobileSized = Math.min(viewport.width, viewport.height) <= 620 || Math.max(viewport.width, viewport.height) <= 980;
  return Boolean(coarsePointer || navigator.maxTouchPoints > 0 || mobileSized);
}

function getSafeAreaInsets() {
  const style = getComputedStyle(elements.deviceStage);
  return {
    safeAreaTop: parseCssPixels(style.paddingTop),
    safeAreaRight: parseCssPixels(style.paddingRight),
    safeAreaBottom: parseCssPixels(style.paddingBottom),
    safeAreaLeft: parseCssPixels(style.paddingLeft),
  };
}

function parseCssPixels(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function getViewportOrientationAngle() {
  const rawAngle = Number.isFinite(window.screen?.orientation?.angle)
    ? window.screen.orientation.angle
    : Number(window.orientation || 0);
  return ((Math.round(rawAngle / 90) * 90) % 360 + 360) % 360;
}

function completeBoot() {
  elements.bootStatus.textContent = "PokéOS ready.";
  window.setTimeout(() => {
    state.bootComplete = true;
    elements.bootScreen.classList.add("boot-complete");
    updateDeviceShell();
  }, 420);
}

function getHardwareStatusText(progress) {
  if (!state.bootComplete) return "BOOT";
  const gate = getDeviceGate(progress);
  if (progress.authPending) return "LOGIN";
  return gate.locked ? "LOCKED" : "ONLINE";
}

function renderOsAccount(progress = state.progress ?? progressStore.getState()) {
  if (!elements.osAccountName || !elements.osAccountMethod) return;
  const identity = getCurrentTrainerIdentity(progress);
  if (!identity) {
    elements.osAccountName.textContent = "Locked";
    elements.osAccountMethod.textContent = getLockStatusText(progress);
    return;
  }

  elements.osAccountName.textContent = identity.displayName;
  elements.osAccountMethod.textContent = getOsAccountMethodLabel(identity.provider);
}

function getOsAccountMethodLabel(provider) {
  if (provider === "google") return "Google Account";
  if (provider === "site") return "Local Account";
  return "Guest File";
}

function getLockStatusText(progress) {
  if (!googleAuthEnvironment.supported) return googleAuthEnvironment.message;
  return progress.status || "Guest access, local account, or Google account accepted.";
}

function getPreferenceKey(progress) {
  if (progress.user?.uid) return `google:${progress.user.uid}`;
  if (progress.localTrainer?.id) return `site:${progress.localTrainer.id}`;
  if (state.deviceAccess?.type === "guest") return "guest";
  return "locked";
}

function isDeviceUnlocked() {
  return !getDeviceGate(state.progress ?? progressStore.getState()).locked;
}

function getDeviceGate(progress) {
  return getAccessGate({
    ...progress,
    access: getGateAccess(progress),
  });
}

function getGateAccess(progress) {
  if (progress?.user?.uid) return { method: "google" };
  if (progress?.localTrainer?.uid) return { method: "registered" };
  if (state.deviceAccess?.type === "guest") return { method: "guest" };
  return null;
}

function getCurrentTrainerIdentity(progress = state.progress ?? progressStore.getState()) {
  if (progress.user) {
    return {
      uid: progress.user.uid,
      displayName: progress.user.displayName || "Google trainer",
      provider: "google",
    };
  }

  if (progress.localTrainer) {
    return {
      uid: progress.localTrainer.uid,
      displayName: progress.localTrainer.displayName,
      provider: "site",
    };
  }

  if (state.deviceAccess?.type === "guest") {
    return {
      uid: "guest",
      displayName: "Guest",
      provider: "guest",
    };
  }

  return null;
}

function isFormField(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable
  );
}

function setLockStatus(text) {
  elements.lockStatus.textContent = text;
}

async function toggleLcdOnlyMode() {
  const nextMode = !state.lcdOnlyMode;
  setLcdOnlyMode(nextMode);

  if (nextMode && document.documentElement.requestFullscreen) {
    await document.documentElement.requestFullscreen().catch(() => {});
  } else if (!nextMode && document.fullscreenElement && document.exitFullscreen) {
    await document.exitFullscreen().catch(() => {});
  }
}

function setLcdOnlyMode(enabled) {
  state.lcdOnlyMode = Boolean(enabled);
  document.documentElement.classList.toggle("lcd-only-mode", state.lcdOnlyMode);
  elements.deviceStage?.classList.toggle("lcd-only-stage", state.lcdOnlyMode);
  updateLcdFullscreenButtons();
  fitDeviceToViewport();
}

function updateLcdFullscreenButtons() {
  const label = state.lcdOnlyMode ? "Shell View" : "LCD Full";
  elements.lcdFullscreenButtons.forEach((button) => {
    button.textContent = label;
    button.setAttribute("aria-pressed", String(state.lcdOnlyMode));
  });
}

async function installMobileApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    setInstallStatus("Install ready.");
    return;
  }

  setInstallStatus("Install from browser menu, or use Android APK.");
}

function setInstallStatus(text) {
  if (isDeviceUnlocked()) {
    elements.settingsStatus.textContent = text;
  } else {
    setLockStatus(text);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function setSelectValue(select, value) {
  const nextValue = String(value ?? "all");
  select.value = [...select.options].some((candidate) => candidate.value === nextValue)
    ? nextValue
    : "all";
}

function escapeText(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}

function formatMeasurements(pokemon) {
  const meters = pokemon.height?.meters;
  const kilograms = pokemon.weight?.kilograms;
  if (!meters && !kilograms) return "No measurements";
  return [
    meters ? `${meters} m` : "",
    kilograms ? `${kilograms} kg` : "",
  ].filter(Boolean).join(" / ");
}

function formatAbilityList(abilities = []) {
  if (!Array.isArray(abilities) || !abilities.length) return "No abilities";
  return abilities
    .slice(0, 3)
    .map((ability) => {
      if (typeof ability === "string") return capitalize(ability.replaceAll("-", " "));
      return ability.displayName || capitalize(String(ability.name || "unknown").replaceAll("-", " "));
    })
    .join(" / ");
}

function readDeviceAccess() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DEVICE_ACCESS_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    if (!["guest", "registered", "local"].includes(parsed.type)) return null;
    return normalizeDeviceAccess(parsed);
  } catch {
    return null;
  }
}

function writeDeviceAccess(access) {
  if (access.type === "google" || access.type === "registered") return;
  try {
    sessionStorage.setItem(DEVICE_ACCESS_KEY, JSON.stringify(access));
  } catch {
    // Session storage can fail in locked-down browser contexts; the live state remains usable.
  }
}

function normalizeDeviceAccess(access) {
  const type = access.type === "local" ? "registered" : access.type;
  const label = String(access.label || (type === "guest" ? "Guest" : "Local Account")).slice(0, 40);
  return {
    type,
    label,
    id: access.id || cleanIdentityId(label),
  };
}

function cleanIdentityId(value) {
  return String(value || "trainer")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "trainer";
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
