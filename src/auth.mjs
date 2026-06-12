import { isBetterScore, mergeIdSets, normalizeTrainerPreferences } from "./core.mjs";

const FIREBASE_VERSION = "10.12.5";
const LOCAL_PROGRESS_KEY = "pokemonQuiz.progress.v1";
const LOCAL_PERSONAL_SCORES_KEY = "pokemonQuiz.personalScores.v1";
const LOCAL_TRAINERS_KEY = "pokemonQuiz.localTrainers.v1";
const ACTIVE_LOCAL_TRAINER_KEY = "pokemonQuiz.activeLocalTrainer.v1";
const LOCAL_TRAINER_PROGRESS_PREFIX = "pokemonQuiz.localTrainerProgress.v1.";
const LOCAL_TRAINER_PERSONAL_SCORES_PREFIX = "pokemonQuiz.localTrainerPersonalScores.v1.";
const LOCAL_TRAINER_PREFERENCES_PREFIX = "pokemonQuiz.localTrainerPreferences.v1.";
const NATIVE_AUTH_RESULT_EVENT = "poke-native-auth-result";
const NATIVE_SIGN_OUT_RESULT_EVENT = "poke-native-signout-result";
export const MIN_NATIVE_WRAPPER_VERSION_CODE = 5;

let nativeAuthRequestCounter = 0;

export function createLocalTrainerStore(storage) {
  return {
    list() {
      return readLocalTrainerProfiles(storage);
    },
    createOrLoad(displayName) {
      const cleanName = cleanTrainerDisplayName(displayName);
      if (!cleanName) {
        return {
          created: false,
          profile: null,
          error: "Enter a trainer name to create or load a local profile.",
        };
      }

      const profiles = readLocalTrainerProfiles(storage);
      const id = cleanIdentityId(cleanName);
      const existing = profiles.find((profile) => profile.id === id);
      if (existing) {
        return { created: false, profile: existing };
      }

      const profile = {
        id,
        uid: `site:${id}`,
        displayName: cleanName,
        provider: "site",
      };
      writeLocalTrainerProfiles(storage, [...profiles, profile]);
      return { created: true, profile };
    },
    load(id) {
      const profileId = cleanIdentityId(id);
      return readLocalTrainerProfiles(storage).find((profile) => profile.id === profileId) ?? null;
    },
    readCorrectPokemonIds(profileId) {
      return readIdsFromStorage(storage, `${LOCAL_TRAINER_PROGRESS_PREFIX}${cleanIdentityId(profileId)}`);
    },
    writeCorrectPokemonIds(profileId, ids) {
      writeJsonToStorage(
        storage,
        `${LOCAL_TRAINER_PROGRESS_PREFIX}${cleanIdentityId(profileId)}`,
        mergeIdSets(ids),
      );
    },
    readPersonalScores(profileId) {
      return readObjectFromStorage(storage, `${LOCAL_TRAINER_PERSONAL_SCORES_PREFIX}${cleanIdentityId(profileId)}`);
    },
    writePersonalScores(profileId, scores) {
      writeJsonToStorage(
        storage,
        `${LOCAL_TRAINER_PERSONAL_SCORES_PREFIX}${cleanIdentityId(profileId)}`,
        scores && typeof scores === "object" && !Array.isArray(scores) ? scores : {},
      );
    },
    readPreferences(profileId, options = {}) {
      return normalizeTrainerPreferences(
        readObjectFromStorage(storage, `${LOCAL_TRAINER_PREFERENCES_PREFIX}${cleanIdentityId(profileId)}`),
        options,
      );
    },
    writePreferences(profileId, preferences, options = {}) {
      writeJsonToStorage(
        storage,
        `${LOCAL_TRAINER_PREFERENCES_PREFIX}${cleanIdentityId(profileId)}`,
        normalizeTrainerPreferences(preferences, options),
      );
    },
  };
}

export function mapGoogleLoginError(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  const text = `${code} ${message}`.toLowerCase();

  if (text.includes("disallowed_useragent") || code === "auth/disallowed-useragent") {
    return {
      status:
        "Google sign-in is blocked in this embedded browser. Use Guest or a local Trainer ID here, or open the game in Chrome.",
      redirectAllowed: false,
    };
  }

  if (code === "auth/popup-blocked") {
    return {
      status: "Popup blocked. Redirecting to Google login...",
      redirectAllowed: true,
    };
  }

  if (code === "auth/operation-not-supported-in-this-environment") {
    return {
      status: "Google popup sign-in is not supported here. Redirecting to Google login...",
      redirectAllowed: true,
    };
  }

  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return {
      status: "Google login was cancelled. Guest and local Trainer profiles are still available.",
      redirectAllowed: false,
    };
  }

  if (code === "auth/popup-timeout") {
    return {
      status: "Google login did not finish. Use Guest or a local Trainer ID here, or try again in Chrome.",
      redirectAllowed: false,
    };
  }

  if (code === "auth/native-login-cancelled") {
    return {
      status: "Google login was cancelled. Guest and local Trainer profiles are still available.",
      redirectAllowed: false,
    };
  }

  if (code === "auth/native-login-unavailable") {
    return {
      status: "Android Google login is unavailable. Use Guest or a local Trainer ID here, or try again in Chrome.",
      redirectAllowed: false,
    };
  }

  return {
    status: `Google login failed: ${error?.message ?? "Unknown error"}`,
    redirectAllowed: false,
  };
}

export function getNativeAuthBridge() {
  return globalThis.window?.PokeNativeAuth ?? null;
}

export function isNativeAuthBridgeAvailable(nativeAuth = getNativeAuthBridge()) {
  return Boolean(nativeAuth && typeof nativeAuth.signIn === "function");
}

export function getNativeWrapperVersionInfo(nativeAuth = getNativeAuthBridge()) {
  if (!nativeAuth || typeof nativeAuth.getVersionInfo !== "function") return null;

  try {
    const raw = nativeAuth.getVersionInfo();
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const versionCode = toPositiveInteger(parsed?.versionCode, 0);
    if (!versionCode) return null;

    return {
      packageName: String(parsed?.packageName || ""),
      versionCode,
      versionName: String(parsed?.versionName || ""),
      updateCapable: Boolean(parsed?.updateCapable),
    };
  } catch {
    return null;
  }
}

export function getNativeWrapperUpdateGate({
  nativeAuth = getNativeAuthBridge(),
  nativeWrapperDetected = isNativeAuthBridgeAvailable(nativeAuth),
  updateManifest = null,
  minimumVersionCode = MIN_NATIVE_WRAPPER_VERSION_CODE,
} = {}) {
  const versionInfo = getNativeWrapperVersionInfo(nativeAuth);
  const latestVersionCode = toPositiveInteger(updateManifest?.versionCode, minimumVersionCode);
  const resolvedMinimumVersionCode = toPositiveInteger(
    updateManifest?.minimumVersionCode ?? updateManifest?.minVersionCode,
    minimumVersionCode,
  );
  const currentVersionCode = versionInfo?.versionCode ?? (nativeWrapperDetected ? 0 : resolvedMinimumVersionCode);
  const required = Boolean(
    nativeWrapperDetected &&
      (currentVersionCode < resolvedMinimumVersionCode ||
        (updateManifest?.required === true && currentVersionCode < latestVersionCode)),
  );

  return {
    required,
    currentVersionCode,
    currentVersionName: versionInfo?.versionName ?? "",
    latestVersionCode,
    latestVersionName: String(updateManifest?.versionName || ""),
    minimumVersionCode: resolvedMinimumVersionCode,
    apkUrl: String(updateManifest?.apkUrl || "downloads/whos-that-pokemon.apk"),
    sha256: String(updateManifest?.sha256 || ""),
    reason: required ? "native-wrapper-outdated" : "",
  };
}

export function requestNativeGoogleIdToken(nativeAuth = getNativeAuthBridge(), options = {}) {
  const eventTarget = globalThis.window;
  const timeoutMs = options.timeoutMs ?? 30000;

  if (!isNativeAuthBridgeAvailable(nativeAuth) || !eventTarget?.addEventListener) {
    const error = new Error("Native Android Google login bridge is unavailable.");
    error.code = "auth/native-login-unavailable";
    return Promise.reject(error);
  }

  const requestId = `native-auth-${Date.now()}-${++nativeAuthRequestCounter}`;

  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      eventTarget.removeEventListener(NATIVE_AUTH_RESULT_EVENT, onResult);
      if (timeoutId) globalThis.clearTimeout(timeoutId);
    };
    const rejectWith = (error) => {
      cleanup();
      reject(error);
    };
    const onResult = (event) => {
      const detail = event?.detail ?? {};
      if (detail.requestId !== requestId) return;

      if (detail.idToken) {
        cleanup();
        resolve(detail.idToken);
        return;
      }

      const error = new Error(detail.message || "Native Android Google login failed.");
      error.code = detail.code || "auth/native-login-failed";
      rejectWith(error);
    };

    eventTarget.addEventListener(NATIVE_AUTH_RESULT_EVENT, onResult);
    if (timeoutMs > 0) {
      timeoutId = globalThis.setTimeout(() => {
        const error = new Error("Native Android Google login timed out.");
        error.code = "auth/popup-timeout";
        rejectWith(error);
      }, timeoutMs);
    }

    try {
      nativeAuth.signIn(requestId);
    } catch (error) {
      error.code = error.code || "auth/native-login-unavailable";
      rejectWith(error);
    }
  });
}

export function requestNativeSignOut(nativeAuth = getNativeAuthBridge(), options = {}) {
  const eventTarget = globalThis.window;
  const timeoutMs = options.timeoutMs ?? 250;

  if (!nativeAuth || typeof nativeAuth.signOut !== "function") {
    return Promise.resolve();
  }
  if (!eventTarget?.addEventListener) {
    const error = new Error("Native Android sign-out bridge is unavailable.");
    error.code = "auth/native-sign-out-unavailable";
    return Promise.reject(error);
  }

  const requestId = `native-signout-${Date.now()}-${++nativeAuthRequestCounter}`;

  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      eventTarget.removeEventListener(NATIVE_SIGN_OUT_RESULT_EVENT, onResult);
      if (timeoutId) globalThis.clearTimeout(timeoutId);
    };
    const rejectWith = (error) => {
      cleanup();
      reject(error);
    };
    const onResult = (event) => {
      const detail = event?.detail ?? {};
      if (detail.requestId !== requestId) return;

      if (!detail.code) {
        cleanup();
        resolve();
        return;
      }

      const error = new Error(detail.message || "Native Android sign-out failed.");
      error.code = detail.code || "auth/native-sign-out-unavailable";
      rejectWith(error);
    };

    eventTarget.addEventListener(NATIVE_SIGN_OUT_RESULT_EVENT, onResult);
    if (timeoutMs > 0) {
      timeoutId = globalThis.setTimeout(() => {
        // Older APKs expose signOut() but do not emit a completion event.
        // The web Firebase sign-out already completes independently, so keep
        // Lock usable while newer wrappers still report explicit failures.
        cleanup();
        resolve();
      }, timeoutMs);
    }

    try {
      nativeAuth.signOut(requestId);
    } catch (error) {
      error.code = error.code || "auth/native-sign-out-unavailable";
      rejectWith(error);
    }
  });
}

export function createProgressStore(onChange = () => {}, options = {}) {
  const localTrainerStore = createLocalTrainerStore(localStorage);
  const activeLocalTrainer = readActiveLocalTrainer(localTrainerStore);
  const firebaseLoader = options.firebaseLoader ?? loadFirebaseModules;
  const state = {
    authReady: false,
    authAvailable: false,
    authPending: false,
    status: "PokéOS login required. Choose Guest, Local Account, or Google.",
    user: null,
    localTrainer: activeLocalTrainer,
    localTrainers: localTrainerStore.list(),
    correctPokemonIds: activeLocalTrainer
      ? localTrainerStore.readCorrectPokemonIds(activeLocalTrainer.id)
      : readLocalIds(),
    personalScores: activeLocalTrainer
      ? localTrainerStore.readPersonalScores(activeLocalTrainer.id)
      : readLocalScores(),
    preferences: activeLocalTrainer
      ? localTrainerStore.readPreferences(activeLocalTrainer.id)
      : normalizeTrainerPreferences(null),
  };

  let firebase = null;

  function getConfiguredNativeAuth() {
    return options.nativeAuth ?? getNativeAuthBridge();
  }

  function emit() {
    onChange(getState());
  }

  function getState() {
    return {
      ...state,
      correctPokemonIds: [...state.correctPokemonIds],
      localTrainer: state.localTrainer ? { ...state.localTrainer } : null,
      localTrainers: state.localTrainers.map((profile) => ({ ...profile })),
      personalScores: { ...state.personalScores },
      preferences: normalizeTrainerPreferences(state.preferences),
    };
  }

  async function init() {
    const nativeAuthAvailable = isNativeAuthBridgeAvailable(getConfiguredNativeAuth());
    if (options.googleAuthSupported === false && !nativeAuthAvailable) {
      state.authReady = true;
      state.authAvailable = false;
      state.status = options.googleAuthUnsupportedMessage ||
        "Google sign-in is available in Chrome. Use Guest or a local Trainer ID in this app.";
      emit();
      return getState();
    }

    const config = window.POKEMON_FIREBASE_CONFIG;
    if (!config || typeof config !== "object" || !config.apiKey) {
      state.authReady = true;
      state.authAvailable = false;
      state.status = "PokéOS login available. Add Firebase config to enable Google.";
      emit();
      return getState();
    }

    try {
      const [{ initializeApp }, authModule, firestoreModule] = await firebaseLoader(FIREBASE_VERSION);

      const app = initializeApp(config);
      const auth = authModule.getAuth(app);
      const db = firestoreModule.getFirestore(app);
      const provider = new authModule.GoogleAuthProvider();
      provider.addScope("profile");
      provider.addScope("email");

      firebase = { auth, db, provider, authModule, firestoreModule };
      state.authReady = true;
      state.authAvailable = true;
      state.status = nativeAuthAvailable
        ? "Google login is available through the Android app."
        : "Google login is available.";
      emit();
      await authModule.getRedirectResult(auth).catch((error) => {
        state.status = mapGoogleLoginError(error).status;
        emit();
        return null;
      });

      authModule.onAuthStateChanged(auth, async (user) => {
        state.authPending = false;
        state.user = user ? normalizeGoogleUser(user) : null;

        if (user) {
          state.localTrainer = null;
          writeActiveLocalTrainerId(null);
          state.status = `Signed in as ${state.user.displayName}.`;
          await mergeCloudProgress(user.uid);
          await mergeCloudPersonalScores(user.uid);
        } else if (state.localTrainer) {
          state.status = `Local account logged in: ${state.localTrainer.displayName}.`;
        } else {
          state.status = "PokéOS login required. Choose Guest, Local Account, or Google.";
        }
        emit();
      });
    } catch (error) {
      state.authReady = true;
      state.authAvailable = false;
      state.status = `Google login unavailable: ${error.message}`;
      emit();
    }

    return getState();
  }

  async function signIn(options = {}) {
    if (!firebase) {
      state.status = "Google login needs Firebase config first.";
      emit();
      return;
    }

    try {
      state.authPending = true;
      state.status = isNativeAuthBridgeAvailable(getConfiguredNativeAuth())
        ? "Opening Android Google login..."
        : "Opening Google login...";
      emit();

      if (isNativeAuthBridgeAvailable(getConfiguredNativeAuth())) {
        const idToken = await requestNativeGoogleIdToken(getConfiguredNativeAuth(), {
          timeoutMs: options.timeoutMs ?? 30000,
        });
        const credential = firebase.authModule.GoogleAuthProvider.credential(idToken);
        const result = await firebase.authModule.signInWithCredential(firebase.auth, credential);
        state.authPending = false;
        if (result?.user) {
          state.user = normalizeGoogleUser(result.user);
          state.localTrainer = null;
          writeActiveLocalTrainerId(null);
          state.status = `Signed in as ${state.user.displayName}.`;
        } else {
          state.status = "Google login complete.";
        }
        emit();
        return;
      }

      if (options.signInFlow === "redirect") {
        await firebase.authModule.signInWithRedirect(firebase.auth, firebase.provider).catch((redirectError) => {
          state.authPending = false;
          state.status = mapGoogleLoginError(redirectError).status;
          emit();
        });
        return;
      }

      const credential = await withTimeout(
        firebase.authModule.signInWithPopup(firebase.auth, firebase.provider),
        options.timeoutMs ?? 30000,
      );
      state.authPending = false;
      if (credential?.user) {
        state.user = normalizeGoogleUser(credential.user);
        state.localTrainer = null;
        writeActiveLocalTrainerId(null);
        state.status = `Signed in as ${state.user.displayName}.`;
      } else {
        state.status = "Google login complete.";
      }
      emit();
    } catch (error) {
      state.authPending = false;
      const mapped = mapGoogleLoginError(error);
      if ((options.allowRedirectFallback ?? true) && mapped.redirectAllowed) {
        state.status = mapped.status;
        emit();
        await firebase.authModule.signInWithRedirect(firebase.auth, firebase.provider).catch((redirectError) => {
          state.authPending = false;
          state.status = mapGoogleLoginError(redirectError).status;
          emit();
        });
        return;
      }

      state.status = mapped.status;
      emit();
    }
  }

  async function signOut({ tolerateErrors = false } = {}) {
    const tasks = [];
    if (firebase) {
      tasks.push(firebase.authModule.signOut(firebase.auth));
    }

    const nativeAuth = getConfiguredNativeAuth();
    if (nativeAuth && typeof nativeAuth.signOut === "function") {
      tasks.push(requestNativeSignOut(nativeAuth));
    }

    if (!tasks.length) return { ok: true, errors: [] };

    const results = await Promise.allSettled(tasks);
    const errors = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length && !tolerateErrors) {
      const error = new Error("Sign-out did not finish. Check your connection and try again.");
      error.causes = errors;
      throw error;
    }

    state.authPending = false;
    state.user = null;
    state.status = state.localTrainer
      ? `Local account logged in: ${state.localTrainer.displayName}.`
      : "PokÃ©OS login required. Choose Guest, Local Account, or Google.";
    emit();

    return { ok: errors.length === 0, errors };
  }

  async function closeActiveSessionAfterRejectedQuiz(
    message = "Run closed. Session locked.",
  ) {
    state.authPending = false;
    if (state.user) {
      await signOut({ tolerateErrors: true }).catch(() => {});
    }

    state.user = null;
    state.localTrainer = null;
    writeActiveLocalTrainerId(null);
    state.correctPokemonIds = readLocalIds();
    state.personalScores = readLocalScores();
    state.preferences = normalizeTrainerPreferences(null);
    state.status = message;
    emit();
    return getState();
  }

  async function recordCorrectPokemon(id) {
    const nextIds = mergeIdSets(state.correctPokemonIds, [id]);
    if (nextIds.length === state.correctPokemonIds.length) return;

    state.correctPokemonIds = nextIds;
    if (state.localTrainer) {
      localTrainerStore.writeCorrectPokemonIds(state.localTrainer.id, nextIds);
    } else {
      writeLocalIds(nextIds);
    }
    emit();

    if (state.user && firebase) {
      await writeCloudProgress(state.user.uid, nextIds);
    }
  }

  async function recordPersonalScore(boardKey, score) {
    const current = state.personalScores[boardKey] ?? null;
    if (!isBetterScore(score, current)) {
      return { saved: false, score: current };
    }

    state.personalScores = {
      ...state.personalScores,
      [boardKey]: score,
    };
    if (state.localTrainer) {
      localTrainerStore.writePersonalScores(state.localTrainer.id, state.personalScores);
    } else {
      writeLocalScores(state.personalScores);
    }
    emit();

    if (state.user && firebase) {
      await writePersonalScore(state.user.uid, boardKey, score);
    }

    return { saved: true, score };
  }

  function createOrLoadLocalTrainer(displayName) {
    const result = localTrainerStore.createOrLoad(displayName);
    state.localTrainers = localTrainerStore.list();
    if (!result.profile) {
      state.status = result.error;
      emit();
      return result;
    }

    activateLocalTrainer(result.profile);
    state.status = result.created
      ? `Local account created for ${result.profile.displayName}.`
      : `Local account loaded for ${result.profile.displayName}.`;
    emit();
    return result;
  }

  function selectLocalTrainer(id) {
    const profile = localTrainerStore.load(id);
    if (!profile) {
      state.status = "Local account was not found.";
      emit();
      return { selected: false, profile: null };
    }

    activateLocalTrainer(profile);
    state.status = `Local account loaded for ${profile.displayName}.`;
    emit();
    return { selected: true, profile };
  }

  function clearLocalTrainer() {
    state.localTrainer = null;
    writeActiveLocalTrainerId(null);
    state.correctPokemonIds = readLocalIds();
    state.personalScores = readLocalScores();
    state.preferences = normalizeTrainerPreferences(null);
    state.status = "PokéOS login required. Choose Guest, Local Account, or Google.";
    emit();
  }

  function activateLocalTrainer(profile) {
    state.user = null;
    state.localTrainer = profile;
    writeActiveLocalTrainerId(profile.id);
    state.correctPokemonIds = localTrainerStore.readCorrectPokemonIds(profile.id);
    state.personalScores = localTrainerStore.readPersonalScores(profile.id);
    state.preferences = localTrainerStore.readPreferences(profile.id);
  }

  function updateTrainerPreferences(preferences, options = {}) {
    state.preferences = normalizeTrainerPreferences(preferences, options);
    if (state.localTrainer) {
      localTrainerStore.writePreferences(state.localTrainer.id, state.preferences, options);
    }
    state.status = state.localTrainer
      ? `Preferences saved for ${state.localTrainer.displayName}.`
      : "Preferences updated for this session.";
    emit();
    return state.preferences;
  }

  async function submitLeaderboardScore(boardKey, score) {
    if (!state.user || !firebase) {
      return { submitted: false, reason: "Sign in with Google to submit public timed scores." };
    }

    const { doc, getDoc } = firebase.firestoreModule;
    const ref = doc(firebase.db, "leaderboards", boardKey, "scores", state.user.uid);
    const snapshot = await getDoc(ref);
    const current = snapshot.exists() ? snapshot.data() : null;
    if (!isBetterScore(score, current)) {
      return { submitted: false, reason: "Existing public score is better.", score: current };
    }

    await writePublicScore(boardKey, score);
    return { submitted: true, score };
  }

  async function loadLeaderboard(boardKey, limitCount = 10) {
    if (!firebase) return [];

    const { collection, getDocs } = firebase.firestoreModule;
    const ref = collection(firebase.db, "leaderboards", boardKey, "scores");
    const snapshot = await getDocs(ref);
    return snapshot.docs
      .map((docSnapshot) => docSnapshot.data())
      .sort(compareScores)
      .slice(0, limitCount);
  }

  async function mergeCloudProgress(uid) {
    if (!firebase) return;

    const { doc, getDoc } = firebase.firestoreModule;
    const ref = doc(firebase.db, "pokemonQuizProfiles", uid);
    const snapshot = await getDoc(ref);
    const remoteIds = snapshot.exists() ? snapshot.data().correctPokemonIds ?? [] : [];
    const mergedIds = mergeIdSets(state.correctPokemonIds, remoteIds);
    state.correctPokemonIds = mergedIds;
    writeLocalIds(mergedIds);
    await writeCloudProgress(uid, mergedIds);
  }

  async function writeCloudProgress(uid, ids) {
    const { doc, serverTimestamp, setDoc } = firebase.firestoreModule;
    const ref = doc(firebase.db, "pokemonQuizProfiles", uid);
    await setDoc(
      ref,
      {
        correctPokemonIds: ids,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  async function mergeCloudPersonalScores(uid) {
    if (!firebase) return;

    const { collection, getDocs } = firebase.firestoreModule;
    const ref = collection(firebase.db, "pokemonQuizProfiles", uid, "personalScores");
    const snapshot = await getDocs(ref);
    const cloudScores = Object.fromEntries(
      snapshot.docs.map((docSnapshot) => [docSnapshot.id, docSnapshot.data()]),
    );
    const mergedScores = { ...state.personalScores };

    for (const [boardKey, score] of Object.entries(cloudScores)) {
      if (isBetterScore(score, mergedScores[boardKey])) mergedScores[boardKey] = score;
    }

    state.personalScores = mergedScores;
    writeLocalScores(mergedScores);

    await Promise.all(
      Object.entries(mergedScores).map(([boardKey, score]) => writePersonalScore(uid, boardKey, score)),
    );
  }

  async function writePersonalScore(uid, boardKey, score) {
    const { doc, serverTimestamp, setDoc } = firebase.firestoreModule;
    const ref = doc(firebase.db, "pokemonQuizProfiles", uid, "personalScores", boardKey);
    await setDoc(
      ref,
      {
        ...score,
        uid,
        displayName: state.user?.displayName || score.displayName || "Trainer",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  async function writePublicScore(boardKey, score) {
    const { doc, serverTimestamp, setDoc } = firebase.firestoreModule;
    const ref = doc(firebase.db, "leaderboards", boardKey, "scores", state.user.uid);
    await setDoc(
      ref,
      {
        ...score,
        uid: state.user.uid,
        displayName: state.user.displayName,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  return {
    getState,
    init,
    signIn,
    signOut,
    closeActiveSessionAfterRejectedQuiz,
    recordCorrectPokemon,
    recordPersonalScore,
    submitLeaderboardScore,
    loadLeaderboard,
    createOrLoadLocalTrainer,
    selectLocalTrainer,
    clearLocalTrainer,
    updateTrainerPreferences,
  };
}

function loadFirebaseModules(version = FIREBASE_VERSION) {
  return Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`),
  ]);
}

function normalizeGoogleUser(user) {
  return {
    uid: user.uid,
    displayName: user.displayName || "Google player",
    photoURL: user.photoURL || "",
    provider: "google",
  };
}

function shouldUseRedirectFallback(error) {
  return mapGoogleLoginError(error).redirectAllowed;
}

function readActiveLocalTrainer(localTrainerStore) {
  try {
    const id = sessionStorage.getItem(ACTIVE_LOCAL_TRAINER_KEY);
    return id ? localTrainerStore.load(id) : null;
  } catch {
    return null;
  }
}

function writeActiveLocalTrainerId(id) {
  try {
    if (id) {
      sessionStorage.setItem(ACTIVE_LOCAL_TRAINER_KEY, cleanIdentityId(id));
    } else {
      sessionStorage.removeItem(ACTIVE_LOCAL_TRAINER_KEY);
    }
  } catch {
    // Session storage can fail in locked-down browser contexts; the live state remains usable.
  }
}

function readLocalTrainerProfiles(storage) {
  const profiles = readArrayFromStorage(storage, LOCAL_TRAINERS_KEY);
  const byId = new Map();

  for (const profile of profiles) {
    const id = cleanIdentityId(profile?.id ?? profile?.displayName);
    const displayName = cleanTrainerDisplayName(profile?.displayName ?? id);
    if (!id || !displayName || byId.has(id)) continue;
    byId.set(id, {
      id,
      uid: `site:${id}`,
      displayName,
      provider: "site",
    });
  }

  return [...byId.values()];
}

function writeLocalTrainerProfiles(storage, profiles) {
  writeJsonToStorage(
    storage,
    LOCAL_TRAINERS_KEY,
    profiles.map((profile) => ({
      id: cleanIdentityId(profile.id),
      uid: `site:${cleanIdentityId(profile.id)}`,
      displayName: cleanTrainerDisplayName(profile.displayName),
      provider: "site",
    })),
  );
}

function readArrayFromStorage(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readIdsFromStorage(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]");
    return mergeIdSets(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function readObjectFromStorage(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonToStorage(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage errors should not block gameplay.
  }
}

function cleanTrainerDisplayName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
}

function cleanIdentityId(value) {
  return String(value || "trainer")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "trainer";
}

function withTimeout(promise, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      const error = new Error("Google login timed out.");
      error.code = "auth/popup-timeout";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    globalThis.clearTimeout(timeoutId);
  });
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function readLocalIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_PROGRESS_KEY) || "[]");
    return mergeIdSets(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function writeLocalIds(ids) {
  try {
    localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(ids));
  } catch {
    // Private browsing and storage quota errors should not block gameplay.
  }
}

function readLocalScores() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_PERSONAL_SCORES_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalScores(scores) {
  try {
    localStorage.setItem(LOCAL_PERSONAL_SCORES_KEY, JSON.stringify(scores));
  } catch {
    // Private browsing and storage quota errors should not block gameplay.
  }
}

function compareScores(left, right) {
  if (Number(left.correct) !== Number(right.correct)) {
    return Number(right.correct) - Number(left.correct);
  }
  return Number(left.elapsedMs) - Number(right.elapsedMs);
}
