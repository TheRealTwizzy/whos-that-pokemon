import { mergeIdSets } from "./core.mjs";

const FIREBASE_VERSION = "10.12.5";
const LOCAL_PROGRESS_KEY = "pokemonQuiz.progress.v1";

export function createProgressStore(onChange = () => {}) {
  const state = {
    authReady: false,
    authAvailable: false,
    status: "Guest progress is stored on this device.",
    user: null,
    correctPokemonIds: readLocalIds(),
  };

  let firebase = null;

  function emit() {
    onChange(getState());
  }

  function getState() {
    return {
      ...state,
      correctPokemonIds: [...state.correctPokemonIds],
    };
  }

  async function init() {
    const config = window.POKEMON_FIREBASE_CONFIG;
    if (!config || typeof config !== "object" || !config.apiKey) {
      state.authReady = true;
      state.authAvailable = false;
      state.status = "Guest mode active. Add Firebase config to enable Google login.";
      emit();
      return getState();
    }

    try {
      const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
      ]);

      const app = initializeApp(config);
      const auth = authModule.getAuth(app);
      const db = firestoreModule.getFirestore(app);
      const provider = new authModule.GoogleAuthProvider();
      provider.addScope("profile");
      provider.addScope("email");

      firebase = { auth, db, provider, authModule, firestoreModule };
      state.authReady = true;
      state.authAvailable = true;
      state.status = "Google login is available.";
      emit();
      await authModule.getRedirectResult(auth).catch(() => null);

      authModule.onAuthStateChanged(auth, async (user) => {
        state.user = user
          ? {
              uid: user.uid,
              displayName: user.displayName || "Google player",
              photoURL: user.photoURL || "",
            }
          : null;

        if (user) {
          state.status = `Signed in as ${state.user.displayName}.`;
          await mergeCloudProgress(user.uid);
        } else {
          state.status = "Guest progress is stored on this device.";
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

  async function signIn() {
    if (!firebase) {
      state.status = "Google login needs Firebase config first.";
      emit();
      return;
    }

    try {
      state.status = "Opening Google login...";
      emit();
      await firebase.authModule.signInWithPopup(firebase.auth, firebase.provider);
    } catch (error) {
      if (shouldUseRedirectFallback(error)) {
        state.status = "Popup blocked. Redirecting to Google login...";
        emit();
        await firebase.authModule.signInWithRedirect(firebase.auth, firebase.provider);
        return;
      }

      state.status = `Google login failed: ${error.message}`;
      emit();
    }
  }

  async function signOut() {
    if (!firebase) return;
    await firebase.authModule.signOut(firebase.auth);
  }

  async function recordCorrectPokemon(id) {
    const nextIds = mergeIdSets(state.correctPokemonIds, [id]);
    if (nextIds.length === state.correctPokemonIds.length) return;

    state.correctPokemonIds = nextIds;
    writeLocalIds(nextIds);
    emit();

    if (state.user && firebase) {
      await writeCloudProgress(state.user.uid, nextIds);
    }
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

  return {
    getState,
    init,
    signIn,
    signOut,
    recordCorrectPokemon,
  };
}

function shouldUseRedirectFallback(error) {
  return [
    "auth/popup-blocked",
    "auth/popup-closed-by-user",
    "auth/operation-not-supported-in-this-environment",
    "auth/cancelled-popup-request",
  ].includes(error?.code);
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
