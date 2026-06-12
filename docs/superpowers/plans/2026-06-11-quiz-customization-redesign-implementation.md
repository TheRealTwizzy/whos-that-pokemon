# Quiz Customization Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved focused quiz setup, v2 timed leaderboard policy, three-attempt quiz loop, autofill, anti-cheat rollback, and PokéOS UI inside the existing PokéDex shell.

**Architecture:** Keep durable policy in `src/core.mjs` so tests can lock leaderboard keys, question presets, preference normalization, attempts, autofill, and rejection rules without browser state. Keep DOM orchestration in `src/app.mjs`, with staged quiz progress committed only on clean completion. Keep existing auth/local trainer storage boundaries in `src/auth.mjs`, adding only helpers needed to reset active sessions after rejection.

**Tech Stack:** Vanilla ES modules, Node `node:test`, static HTML/CSS, Firebase Auth/Firestore client APIs.

---

## File Structure

- Modify `src/core.mjs`: add v2 setup constants/helpers, preference normalization, v2 key generation, eligibility, attempts, autofill, and rejection classification helpers.
- Modify `tests/core.test.mjs`: add red/green coverage for v2 helpers and update old v1 leaderboard expectations.
- Modify `src/auth.mjs`: expose a session-close helper that can sign out Google or clear local active access without deleting stored local profiles.
- Modify `tests/auth.test.mjs`: cover local profile persistence after active-session clearing.
- Modify `index.html`: replace old Settings gameplay controls with focused Quiz app controls and add attempt/autofill/rejection UI hooks.
- Modify `src/app.mjs`: wire new setup controls, staged PokéDex commits, three attempts, timer pause/resume on correct reveal, autofill, rejection triggers, v2 score writes, and PokéOS states.
- Modify `styles.css`: finalize PokéOS menu/control/autofill/rejection responsive styling.
- Modify `firestore.rules`: restrict public score writes to v2 board keys when feasible while retaining score-shape/ownership checks.
- Modify `README.md`: document the redesigned setup, timed/personal/public rules, anti-cheat rejection, and v2 leaderboard behavior.

---

### Task 1: V2 Policy Helpers

**Files:**
- Modify: `tests/core.test.mjs`
- Modify: `src/core.mjs`

- [ ] **Step 1: Write failing tests for question presets, v2 keys, eligibility, attempts, and autofill**

Add imports for the new helpers:

```js
import {
  buildAutofillSuggestions,
  buildLeaderboardKey,
  getAvailableQuestionOptions,
  isAttemptSubmission,
  isLeaderboardEligible,
  normalizeTrainerPreferences,
  resolveQuizSettings,
  shouldRejectQuizEvent,
} from "../src/core.mjs";
```

Add tests:

```js
test("resolves focused quiz settings and suppresses duplicate full-generation presets", () => {
  const genTwoPool = Array.from({ length: 100 }, (_, index) => ({
    id: 152 + index,
    name: `johto-${index + 1}`,
    displayName: `Johto ${index + 1}`,
    generationId: 2,
  }));

  assert.deepEqual(getAvailableQuestionOptions({ generation: "2", poolSize: genTwoPool.length }), [
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
    poolSize: genTwoPool.length,
  }), {
    version: "v2",
    generation: "2",
    questionToken: "entire-generation",
    length: 100,
    answerStyle: "choice",
    timed: true,
    leaderboard: true,
    publicEligiblePreset: true,
  });
});

test("keeps national All Pokémon personal-only and serializes v2 board keys", () => {
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

test("normalizes legacy quiz defaults into focused v2 defaults", () => {
  const preferences = normalizeTrainerPreferences({
    quizDefaults: {
      guessMode: "type",
      presentation: "color",
      type: "electric",
      search: "pika",
      generation: "1",
      answerStyle: "choice",
      timed: true,
      leaderboard: true,
      lengthMode: "custom",
      customLength: 150,
    },
  }, { poolSize: 151 });

  assert.deepEqual(preferences.quizDefaults, {
    generation: "1",
    questions: "entire-generation",
    answerStyle: "choice",
    timed: true,
    leaderboard: true,
  });
});

test("builds normalized typed autofill suggestions without auto-submit semantics", () => {
  const suggestions = buildAutofillSuggestions("mime", SAMPLE_Pokémon, { limit: 5 });
  assert.deepEqual(suggestions, [
    { id: 439, label: "Mime Jr.", value: "Mime Jr." },
  ]);
});

test("classifies attempts and quiz rejection events", () => {
  assert.equal(isAttemptSubmission(""), false);
  assert.equal(isAttemptSubmission("   "), false);
  assert.equal(isAttemptSubmission("Pika"), true);

  assert.equal(shouldRejectQuizEvent({ type: "paste" }), true);
  assert.equal(shouldRejectQuizEvent({ type: "drop" }), true);
  assert.equal(shouldRejectQuizEvent({ type: "visibilitychange", hidden: true }), true);
  assert.equal(shouldRejectQuizEvent({ type: "blur", targetWithinPage: true }), false);
});
```

- [ ] **Step 2: Run tests to verify red**

Run: `npm test`

Expected: FAIL because the new helpers are not exported or do not yet implement v2 policy.

- [ ] **Step 3: Implement minimal policy helpers in `src/core.mjs`**

Add:

```js
const PUBLIC_QUESTION_TOKENS = new Set(["25", "50", "100", "entire-generation"]);
const QUESTION_TOKENS = new Set(["25", "50", "100", "entire-generation", "all-pokemon"]);
const ANSWER_STYLES_V2 = new Set(["typed", "choice"]);
```

Implement `getAvailableQuestionOptions`, `resolveQuizSettings`, `buildLeaderboardKey` v2 handling with legacy fallback only if `settings.version !== "v2"`, `isLeaderboardEligible` v2 handling, `buildAutofillSuggestions`, `isAttemptSubmission`, and `shouldRejectQuizEvent`. Update `getTrainerPreferenceDefaults` and `normalizeTrainerPreferences` so `quizDefaults` uses `{ generation, questions, answerStyle, timed, leaderboard }`.

- [ ] **Step 4: Run tests to verify green**

Run: `npm test`

Expected: all tests pass.

---

### Task 2: Auth Session Reset Hook

**Files:**
- Modify: `tests/auth.test.mjs`
- Modify: `src/auth.mjs`

- [ ] **Step 1: Write failing test for clearing active local session without deleting profiles**

Add:

```js
test("clears active local trainer access without deleting stored profiles", () => {
  const storage = createMemoryStorage();
  const trainers = createLocalTrainerStore(storage);
  const red = trainers.createOrLoad("Red").profile;

  storage.setItem("PokémonQuiz.activeLocalTrainer.v1", red.id);
  storage.removeItem("PokémonQuiz.activeLocalTrainer.v1");

  assert.deepEqual(trainers.list(), [red]);
  assert.equal(trainers.load("red").displayName, "Red");
});
```

- [ ] **Step 2: Run tests to verify red/coverage**

Run: `npm test`

Expected: tests still pass if the storage behavior already exists; if so, add app-level coverage in Task 3 for actual rejection reset.

- [ ] **Step 3: Add app-facing close helper**

Expose `closeActiveSessionAfterRejectedQuiz()` from `createProgressStore`. It should call Firebase sign out for Google users, clear local active trainer for local trainer sessions, set status to a rejection message, and emit. It must not delete stored local trainer profiles or stored pre-quiz progress.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: all tests pass.

---

### Task 3: Focused Setup UI And State Wiring

**Files:**
- Modify: `index.html`
- Modify: `src/app.mjs`
- Modify: `styles.css`

- [ ] **Step 1: Replace old gameplay controls in HTML**

In the Quiz panel, add focused controls with these IDs: `setup-generation`, `setup-questions`, `setup-answer-style`, `setup-timed`, `setup-leaderboard`, `setup-preview`.

Remove player-facing controls for guess mode, presentation, type filter, search filter, custom length, and old 25/50/150/250 length cluster from Settings.

- [ ] **Step 2: Update app element references**

Replace old setup references with the new IDs. Keep trainer avatar/theme in Settings. Use `resolveQuizSettings` and `getAvailableQuestionOptions` to populate/disable question choices.

- [ ] **Step 3: Update setup preview and leaderboard preview**

Preview should show generation, question count, answer style, timed state, leaderboard state, personal-only/public eligibility, and Google Auth requirement when applicable.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: all tests pass.

---

### Task 4: Three-Attempt Loop, Autofill, Timer Pause, And Rollback

**Files:**
- Modify: `index.html`
- Modify: `src/app.mjs`
- Modify: `styles.css`

- [ ] **Step 1: Add quiz UI hooks**

Add `attempts-remaining` metric and `autofill-list` below the typed input. Remove Reveal/Skip. Keep Next for post-result progression.

- [ ] **Step 2: Stage quiz progress**

Add state fields for `attemptsRemaining`, `stagedCorrectIds`, `quizRejected`, `quizCommitInProgress`, `eligibilitySnapshot`, and timer pause bookkeeping. Do not call `recordCorrectPokémon` until clean completion.

- [ ] **Step 3: Implement typed autofill**

On input, call `buildAutofillSuggestions(input, state.pool)` and render a bounded PokéOS list. Clicking a suggestion fills the input and marks that mutation as app-approved without submitting.

- [ ] **Step 4: Implement attempts**

Empty typed submissions do not consume attempts. Non-empty wrong typed submissions consume attempts. Wrong choices consume attempts and disable that choice. Correct answers pause the timer, reveal the Pokémon, stage the ID, and show Next. Three failed attempts mark the round incorrect without revealing.

- [ ] **Step 5: Implement rejection**

Listen for `paste`, `drop`, hidden `visibilitychange`, `pagehide`, and app pause equivalents. On rejection, stop timer, discard staged IDs, prevent score writes, close active session, return to lock screen, and show rejection copy.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: all tests pass.

---

### Task 5: V2 Scores, Firestore Rules, README

**Files:**
- Modify: `src/app.mjs`
- Modify: `firestore.rules`
- Modify: `README.md`

- [ ] **Step 1: Write v2 score payloads**

Score payloads should include `boardKey`, `settings.version`, `settings.generation`, `settings.questionToken`, `settings.length`, `settings.answerStyle`, `settings.inputDevice`, `leaderboard`, and `rejected: false`.

- [ ] **Step 2: Submit public scores only from start-snapshotted Google eligibility**

Use the eligibility snapshot captured at quiz start. Guest/local-started runs stay personal-only even if auth changes mid-run.

- [ ] **Step 3: Update Firestore rules**

Allow valid score writes where `boardKey` is a string beginning with `v2|`, includes the automatic `device:keyboard` or `device:touch` token, ownership is correct, score shape is valid, and score totals are sane. Keep legacy behavior only if needed for existing deployed clients.

- [ ] **Step 4: Update README**

Document the focused setup, 25/50/100/Entire Generation/All Pokémon rules, typed autofill, three attempts, anti-cheat rejection, personal-best behavior, and v2 public leaderboard rules.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: all tests pass.

---

### Task 6: PokéOS Styling And Browser QA

**Files:**
- Modify: `styles.css`
- Verify: local browser via dev server

- [ ] **Step 1: Finalize PokéOS controls**

Style generation/question/answer/timed/leaderboard controls as PokéOS menus rather than native dashboard cards. Ensure disabled states, selected states, and focus cursor are obvious.

- [ ] **Step 2: Finalize mobile shell behavior**

At narrow widths, compress decorative shell chrome before controls become cramped. Keep Start Quiz after preview and before secondary actions.

- [ ] **Step 3: Start local server**

Run: `python -m http.server 4173`

Expected: local app served at `http://localhost:4173`.

- [ ] **Step 4: Browser QA**

Use browser automation to verify setup, typed quiz, multiple-choice quiz, personal-only All Pokémon, leaderboard disabled states, paste rejection, and mobile/desktop screenshots.

- [ ] **Step 5: Stop server**

Stop the local server before completion.

---

## Self-Review

Spec coverage:
- Focused setup: Tasks 1 and 3.
- Question presets and leaderboard policy: Tasks 1 and 5.
- Three attempts, autofill, timer pause, rollback: Task 4.
- PokéOS UI: Tasks 3 and 6.
- Tests and QA: Tasks 1, 2, 4, 5, and 6.

No placeholders are intentionally left in this plan. Function names introduced here are owned by Task 1 before later tasks use them.
