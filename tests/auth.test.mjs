import test from "node:test";
import assert from "node:assert/strict";

import {
  createProgressStore,
  createLocalTrainerStore,
  mapGoogleLoginError,
  requestNativeGoogleIdToken,
} from "../src/auth.mjs";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("creates and reloads stable local trainer profiles by normalized name", () => {
  const storage = createMemoryStorage();
  const trainers = createLocalTrainerStore(storage);

  const first = trainers.createOrLoad("  Red  ");
  const second = trainers.createOrLoad("red");

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual(first.profile, {
    id: "red",
    uid: "site:red",
    displayName: "Red",
    provider: "site",
  });
  assert.deepEqual(second.profile, first.profile);
  assert.deepEqual(trainers.list(), [first.profile]);
});

test("stores PokeDex progress and personal scores in isolated local trainer namespaces", () => {
  const storage = createMemoryStorage();
  const trainers = createLocalTrainerStore(storage);
  const red = trainers.createOrLoad("Red").profile;
  const blue = trainers.createOrLoad("Blue").profile;
  const score = {
    boardKey: "board-a",
    correct: 25,
    total: 25,
    elapsedMs: 12500,
  };

  trainers.writeCorrectPokemonIds(red.id, [25, 1, 25]);
  trainers.writeCorrectPokemonIds(blue.id, [4]);
  trainers.writePersonalScores(red.id, { "board-a": score });

  assert.deepEqual(trainers.readCorrectPokemonIds(red.id), [1, 25]);
  assert.deepEqual(trainers.readCorrectPokemonIds(blue.id), [4]);
  assert.deepEqual(trainers.readPersonalScores(red.id), { "board-a": score });
  assert.deepEqual(trainers.readPersonalScores(blue.id), {});
});

test("stores preferences in isolated local trainer namespaces", () => {
  const storage = createMemoryStorage();
  const trainers = createLocalTrainerStore(storage);
  const red = trainers.createOrLoad("Red").profile;
  const blue = trainers.createOrLoad("Blue").profile;

  trainers.writePreferences(red.id, {
    avatarId: 133,
    themeId: "ocean",
    quizDefaults: {
      guessMode: "type",
      answerStyle: "choice",
      presentation: "color",
      timed: true,
      lengthMode: "preset",
      lengthPreset: 50,
      customLength: 10,
      type: "water",
      generation: "all",
      search: "",
    },
  });

  assert.deepEqual(trainers.readPreferences(red.id), {
    avatarId: 133,
    themeId: "ocean",
    quizDefaults: {
      generation: "all",
      questions: "50",
      answerStyle: "choice",
      timed: true,
      leaderboard: false,
    },
  });
  assert.deepEqual(trainers.readPreferences(blue.id), {
    avatarId: 25,
    themeId: "classic",
    quizDefaults: {
      generation: "all",
      questions: "25",
      answerStyle: "typed",
      timed: false,
      leaderboard: false,
    },
  });
});

test("normalizes corrupt stored trainer preferences instead of throwing", () => {
  const storage = createMemoryStorage();
  const trainers = createLocalTrainerStore(storage);
  const red = trainers.createOrLoad("Red").profile;
  storage.setItem("pokemonQuiz.localTrainerPreferences.v1.red", JSON.stringify({
    avatarId: "nope",
    themeId: "neon",
    quizDefaults: { lengthMode: "custom", customLength: -1 },
  }));

  assert.deepEqual(trainers.readPreferences(red.id), {
    avatarId: 25,
    themeId: "classic",
    quizDefaults: {
      generation: "all",
      questions: "25",
      answerStyle: "typed",
      timed: false,
      leaderboard: false,
    },
  });
});

test("closes active local trainer access after rejected quiz without deleting stored profiles", async () => {
  const localStorage = createMemoryStorage();
  const sessionStorage = createMemoryStorage();
  const restoreStorage = installBrowserStorage({ localStorage, sessionStorage });

  try {
    const progressStore = createProgressStore(() => {});
    const red = progressStore.createOrLoadLocalTrainer("Red").profile;

    await progressStore.closeActiveSessionAfterRejectedQuiz();

    assert.equal(progressStore.getState().localTrainer, null);
    assert.equal(sessionStorage.getItem("pokemonQuiz.activeLocalTrainer.v1"), null);
    assert.equal(progressStore.getState().status, "Run closed. Session locked.");

    const trainers = createLocalTrainerStore(localStorage);
    assert.deepEqual(trainers.list(), [red]);
    assert.equal(trainers.load("red").displayName, "Red");
  } finally {
    restoreStorage();
  }
});

test("maps disallowed Google user agents to a local-friendly retry state", () => {
  assert.deepEqual(
    mapGoogleLoginError({ code: "auth/disallowed-useragent", message: "Error 403: disallowed_useragent" }),
    {
      status: "Google sign-in is blocked in this embedded browser. Use Guest or a local Trainer ID here, or open the game in Chrome.",
      redirectAllowed: false,
    },
  );
  assert.deepEqual(
    mapGoogleLoginError({ code: "auth/popup-blocked", message: "Popup blocked" }),
    {
      status: "Popup blocked. Redirecting to Google login...",
      redirectAllowed: true,
    },
  );
  assert.deepEqual(
    mapGoogleLoginError({
      code: "auth/operation-not-supported-in-this-environment",
      message: "This operation is not supported.",
    }),
    {
      status: "Google popup sign-in is not supported here. Redirecting to Google login...",
      redirectAllowed: true,
    },
  );
  assert.deepEqual(
    mapGoogleLoginError({ code: "auth/popup-closed-by-user", message: "Closed by user" }),
    {
      status: "Google login was cancelled. Guest and local Trainer profiles are still available.",
      redirectAllowed: false,
    },
  );
});

test("requests a Google ID token through the native Android bridge", async () => {
  const restoreWindow = installWindowEventTarget();
  const requestedIds = [];

  try {
    const nativeAuth = {
      signIn(requestId) {
        requestedIds.push(requestId);
        queueMicrotask(() => {
          window.dispatchEvent(new CustomEvent("poke-native-auth-result", {
            detail: {
              requestId,
              idToken: "native-google-id-token",
            },
          }));
        });
      },
    };

    const idToken = await requestNativeGoogleIdToken(nativeAuth, { timeoutMs: 100 });

    assert.equal(idToken, "native-google-id-token");
    assert.equal(requestedIds.length, 1);
    assert.match(requestedIds[0], /^native-auth-/);
  } finally {
    restoreWindow();
  }
});

test("signs into web Firebase with the Google ID token returned by native Android", async () => {
  const restoreWindow = installWindowEventTarget({ POKEMON_FIREBASE_CONFIG: { apiKey: "test-key" } });
  const restoreStorage = installBrowserStorage({
    localStorage: createMemoryStorage(),
    sessionStorage: createMemoryStorage(),
  });
  const calls = [];
  let authStateCallback = () => {};

  try {
    const nativeAuth = {
      signIn(requestId) {
        calls.push(["native-sign-in", requestId]);
        queueMicrotask(() => {
          window.dispatchEvent(new CustomEvent("poke-native-auth-result", {
            detail: {
              requestId,
              idToken: "native-google-id-token",
            },
          }));
        });
      },
      signOut() {
        calls.push(["native-sign-out"]);
      },
    };
    const firebaseLoader = createFakeFirebaseLoader({
      onAuthStateChanged(callback) {
        authStateCallback = callback;
      },
      signInWithCredential(auth, credential) {
        calls.push(["web-sign-in", credential]);
        queueMicrotask(() => {
          authStateCallback({
            uid: "firebase-user",
            displayName: "Native Trainer",
            photoURL: "https://example.test/trainer.png",
          });
        });
        return Promise.resolve({ user: { uid: "firebase-user", displayName: "Native Trainer" } });
      },
    });
    const store = createProgressStore(() => {}, {
      firebaseLoader,
      nativeAuth,
    });

    await store.init();
    await store.signIn({ timeoutMs: 100 });

    assert.deepEqual(calls[0], ["native-sign-in", calls[0][1]]);
    assert.deepEqual(calls[1], ["web-sign-in", { providerId: "google.com", idToken: "native-google-id-token" }]);
    assert.equal(store.getState().user.displayName, "Native Trainer");

    await store.signOut();

    assert.deepEqual(calls.at(-1), ["native-sign-out"]);
  } finally {
    restoreStorage();
    restoreWindow();
  }
});

function installBrowserStorage({ localStorage, sessionStorage }) {
  const descriptors = {
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: sessionStorage,
  });

  return () => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  };
}

function installWindowEventTarget(properties = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const eventTarget = new EventTarget();
  Object.assign(eventTarget, properties);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: eventTarget,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      delete globalThis.window;
    }
  };
}

function createFakeFirebaseLoader(overrides = {}) {
  return async function fakeFirebaseLoader() {
    const authModule = {
      getAuth() {
        return {};
      },
      GoogleAuthProvider: class GoogleAuthProvider {
        static credential(idToken) {
          return { providerId: "google.com", idToken };
        }

        addScope() {}
      },
      getRedirectResult() {
        return Promise.resolve(null);
      },
      onAuthStateChanged(auth, callback) {
        overrides.onAuthStateChanged?.(callback);
      },
      signInWithCredential: overrides.signInWithCredential,
      signInWithPopup() {
        throw new Error("Popup sign-in should not be used when native auth is available.");
      },
      signInWithRedirect() {
        throw new Error("Redirect sign-in should not be used when native auth is available.");
      },
      signOut() {
        return Promise.resolve();
      },
    };
    const firestoreModule = {
      getFirestore() {
        return {};
      },
      doc() {
        return {};
      },
      collection() {
        return {};
      },
      getDoc() {
        return Promise.resolve({ exists: () => false, data: () => ({}) });
      },
      getDocs() {
        return Promise.resolve({ docs: [] });
      },
      setDoc() {
        return Promise.resolve();
      },
      serverTimestamp() {
        return "server-timestamp";
      },
    };

    return [
      { initializeApp: () => ({}) },
      authModule,
      firestoreModule,
    ];
  };
}
