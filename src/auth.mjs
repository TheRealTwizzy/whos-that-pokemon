import { isBetterScore, mergeIdSets } from "./core.mjs";

const FIREBASE_VERSION = "10.12.5";
const LOCAL_PROGRESS_KEY = "pokemonQuiz.progress.v1";
const LOCAL_PERSONAL_SCORES_KEY = "pokemonQuiz.personalScores.v1";

export function createProgressStore(onChange = () => {}) {
  const state = {
    authReady: false,
    authAvailable: false,
    status: "PokeDex locked. Choose Guest, Register, or Google Auth.",
    user: null,
    correctPokemonIds: readLocalIds(),
    personalScores: readLocalScores(),
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
      state.status = "Guest and local registration available. Add Firebase config to enable Google Auth.";
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
              provider: "google",
            }
          : null;

        if (user) {
          state.status = `Signed in as ${state.user.displayName}.`;
          await mergeCloudProgress(user.uid);
          await mergeCloudPersonalScores(user.uid);
        } else {
          state.status = "PokeDex locked. Choose Guest, Register, or Google Auth.";
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

  async function recordPersonalScore(boardKey, score) {
    const current = state.personalScores[boardKey] ?? null;
    if (!isBetterScore(score, current)) {
      return { saved: false, score: current };
    }

    state.personalScores = {
      ...state.personalScores,
      [boardKey]: score,
    };
    writeLocalScores(state.personalScores);
    emit();

    if (state.user && firebase) {
      await writePersonalScore(state.user.uid, boardKey, score);
    }

    return { saved: true, score };
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
    recordCorrectPokemon,
    recordPersonalScore,
    submitLeaderboardScore,
    loadLeaderboard,
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
