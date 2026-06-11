# Quiz Customization Redesign

Date: 2026-06-11
Status: Draft updated from review comments

## Context

The current quiz has a launcher-style Quiz tab and a separate Settings tab that
contains most of the gameplay choices. That makes the main quiz entry point
quick, but it hides the settings that decide what kind of run the player is
starting. Several controls also create leaderboard complexity without adding
enough player value: guess mode, presentation mode, type filter, search filter,
and custom length.

The redesign replaces the current broad customization panel with a focused Quiz
Setup surface. The setup keeps only choices that materially affect the play
session and leaderboard category.

## Goals

- Make quiz setup obvious from the first quiz screen.
- Replace numeric/custom length behavior with a generation-aware question-count
  model.
- Keep public leaderboard categories understandable and fair.
- Preserve timed personal bests for non-public runs.
- Remove low-value customization settings from the player-facing flow.
- Preserve local trainer, Google Auth, PokeDex log, theme/avatar, personal best,
  and public leaderboard features.
- Make active quiz sessions strict enough to reject obvious cheating signals.

## Non-Goals

- Do not redesign authentication or local trainer storage.
- Do not add new Pokemon data sources.
- Do not add type, generation, or number guessing as alternate quiz modes.
- Do not add non-silhouette presentation modes.
- Do not clone proprietary Game Boy Color or Pokemon game assets. The PokeOS UI
  should be original CSS/UI work that evokes the menu rhythm and layout style of
  Pokemon Red, Blue, and Yellow.

## Quiz Setup

The Quiz tab becomes the main setup and launch surface. It exposes these
controls:

- Generation: All, Gen 1 Kanto, Gen 2 Johto, and each available generation.
- Questions:
  - When Generation is All: 25, 50, 100, All Pokemon.
  - When one generation is selected: 25, 50, 100, Entire Generation.
- Answer: Typed or Multiple Choice.
- Timed: Yes or No.
- Leaderboard: Yes or No.

Silhouette is always enabled. The prompt is always the classic "Who's That
Pokemon?" name-identification format.

The setup screen should also show a concise run preview, including matched pool
size, final question count, whether the run is timed, whether it can submit to a
public board, and whether the current trainer is eligible to submit.

Questions 25, 50, and 100 are enabled only when the selected pool contains at
least that many Pokemon. Entire Generation is available only when a single
generation is selected and resolves to that full generation. All Pokemon is
available only when Generation is All and resolves to the full national pool.
All Pokemon is personal-best/non-public only. If a single generation's full size
matches a fixed preset, show the full-run option as Entire Generation and
suppress the duplicate fixed preset for that generation. For example, Gen 2's
100-Pokemon full run should use Entire Generation, not a separate 100 board.

Leaderboard is a separate player control, but it is gated:

- Timed: No forces Leaderboard: No and disables the Leaderboard control.
- Timed: Yes enables Leaderboard selection for public-capable question presets.
- All Pokemon forces Leaderboard: No and disables the Leaderboard control.
- Guest and local trainer sessions may select Leaderboard: Yes to express
  intent, but the preview must say that Google Auth is required for public
  submission and that the run will save personal best only unless the player
  signs in.
- Google Auth sessions with Timed: Yes and Leaderboard: Yes are public-submit
  eligible after completion.

## Removed Player Settings

Remove these controls from player-facing setup:

- Guess mode: type, generation, and Pokedex number.
- Presentation: colored image.
- Type filter.
- Name or number search filter.
- Custom length input.
- The old 25/50/150/250 preset cluster.
- Reveal/Skip as an answer-revealing escape hatch.

These capabilities can remain internally where they are still needed for data
normalization, legacy saved preferences, or future migrations, but they should
not appear as active customization controls in the redesigned setup.

## Gameplay Loop

Each round shows a large silhouette and asks the player to name the Pokemon.
The quiz HUD emphasizes:

- Progress.
- Score.
- Timer state.
- Attempts remaining.

Typed-answer runs show an in-app autofill list below the answer input as the
player types. The list contains available Pokemon guesses that alphabetically
match the typed prefix. Suggestions come from the selected quiz pool, not only
the current round list and not the entire catalog when a generation is selected.
Matching uses the same answer normalization rules as typed guesses so casing,
spacing, punctuation, gender symbols, diacritics, and known name aliases behave
consistently. Selecting an autofill option fills the input with that Pokemon
name, but it does not submit the answer. The player must still press the Guess
button.

Each question gives the player three submitted attempts. In typed-answer runs,
pressing Guess counts as one attempt. Selecting an autofill option does not count
as an attempt. In multiple-choice runs, selecting an answer choice counts as one
attempt.

Attempt validity rules:

- Empty or whitespace-only typed submissions do not count as attempts.
- Any non-empty typed submission counts as an attempt, including partial names,
  invalid names, and duplicate guesses.
- A disabled or already-selected multiple-choice option cannot be selected again
  and does not count again.

Scoring remains correct-count first, elapsed-time second. Wrong attempts do not
directly subtract points; they cost time and consume attempts. A Pokemon
answered correctly within three attempts earns one point, reveals the correct
Pokemon, and queues that Pokemon for the PokeDex log. If the player uses all
three attempts without the correct answer, the question is marked incorrect,
the answer is not revealed, the PokeDex log is not filled for that Pokemon, and
the quiz advances without awarding a point.

The timer starts when the first quiz round is shown after Start Quiz. It keeps
running while the player is actively answering and while incorrect feedback is
shown. When a correct answer is revealed, the stopwatch pauses for the reveal
state. It resumes at the beginning of the next quiz question. It stops only when
the final round completes or when the quiz is rejected/closed.

## Session Integrity And Rollback

Active quiz progress should be staged until the run ends cleanly. Correct
answers should not permanently update the PokeDex log, personal bests, or public
leaderboards until the quiz completes without rejection.

Allowed input mutation paths are normal keyboard/IME typing and the app's own
autofill selection. The active quiz is immediately rejected if the player:

- Leaves or minimizes the active browser tab.
- Backgrounds or minimizes the mobile app.
- Uses paste/drop, browser autofill, script-driven field mutation, or any
  non-keyboard/non-in-app-autofill path to fill an answer.

On rejection, the app must stop the stopwatch, discard the active quiz result,
discard staged PokeDex updates from the run, prevent personal-best and public
leaderboard writes, close the current session, and return to the locked state.
For Google sessions, this means signing the player out. For guest or local
trainer sessions, this means clearing active access and requiring the player to
unlock again. Stored local trainer profiles and existing pre-quiz progress are
not deleted.

Implementation should treat `document.visibilityState === "hidden"`, `pagehide`,
navigation away, and platform app-pause/background signals as rejection events.
Plain input blur, focus changes inside the page, and scrolling do not reject a
run by themselves.

Public-submission eligibility is snapshotted at quiz start. A run started as a
guest or local trainer run cannot become public-eligible through a mid-run sign
in. A clean completion occurs only after the final round result is locked and
the staged completion commit finishes. Rejection remains active until that
commit boundary, then the completed run may show its summary without later
visibility changes invalidating it.

## Leaderboard Model

Public boards are keyed by:

- Generation selection.
- Question count.
- Resolved total.
- Answer style.

Examples:

- `v2|gen:all|q:25|total:25|answer:typed`.
- `v2|gen:all|q:50|total:50|answer:choice`.
- `v2|gen:all|q:100|total:100|answer:typed`.
- `v2|gen:1|q:entire-generation|total:151|answer:typed`.
- `v2|gen:2|q:25|total:25|answer:choice`.

Typed and multiple-choice runs never share the same board.

Public submission requires:

- Google Auth user.
- Timed: Yes.
- Leaderboard: Yes.
- Completed quiz.
- A public-capable question preset.
- No session rejection.

Guests and local trainers can run timed quizzes and save personal bests, but
they do not submit public scores.

Timed: Yes plus Leaderboard: No saves personal best only. Timed: No is casual
and does not save timed bests or submit to public boards.

Public-capable question presets are:

- 25.
- 50.
- 100.
- Entire Generation, only when a single generation is selected.

All Pokemon is available only when Generation is All. It may save timed personal
bests, but it is never public leaderboard eligible.

This intentionally changes the earlier v1 public-board policy. The redesigned
v2 policy drops the old 150 and 250 public presets, adds 100, adds
single-generation full-run boards, and removes the national All Pokemon run from
public leaderboard eligibility.

## Data And Preference Behavior

Saved quiz defaults should map to the redesigned setup model. Existing saved
preferences that reference removed settings should normalize safely:

- Guess mode becomes name.
- Presentation becomes silhouette.
- Removed filters become All/no filter.
- Custom or old preset lengths map to Questions 25, 50, 100, Entire Generation,
  or All Pokemon using a deterministic compatibility rule.

The leaderboard key should be replaced for active flows. The redesigned app
should use a v2 key and stop using the v1 key for active leaderboards and active
personal-best writes. The new key should include generation, question count,
resolved total, and answer style. It should not include removed settings.

Personal best storage should use the same redesigned board key for timed runs,
including runs that are not publicly submitted.

The v2 key should use stable setup terms, not removed settings:

- Version: v2.
- Generation token: all or the generation id.
- Question token: 25, 50, 100, entire-generation, or all-pokemon.
- Resolved total: the final number of questions in the run. For fixed presets,
  this is 25, 50, or 100. For Entire Generation and All Pokemon, this is the
  resolved full-run pool size.
- Answer style: typed or choice.

Including the resolved total prevents full-run boards from mixing runs with
different catalog sizes if data changes later. Existing v1 public scores are
legacy data and should not be read into v2 leaderboard views. Existing v1
personal bests may remain readable as legacy data, but they should not be
treated as v2 bests unless an explicit future migration proves comparability.

Saved preference compatibility uses this deterministic mapping:

- Old preset or custom length 25 or lower maps to Questions: 25.
- Old preset or custom length 26 through 50 maps to Questions: 50.
- Old preset or custom length 51 through 100 maps to Questions: 100 when that
  count is available.
- Old preset or custom length above 100 maps to Entire Generation when one
  generation is selected, or All Pokemon when Generation is All.
- If the mapped fixed count is unavailable for the selected pool, fall back to
  Entire Generation for a single generation or All Pokemon for Generation: All.
- Old guess mode maps to name.
- Old presentation maps to silhouette.
- Removed filters map to All/no filter.

Implementation should remove stale generated artifacts and temporary review
outputs produced during this redesign work so old assumptions do not remain in
the repo and steer later implementation.

Firestore rules and client writes should prefer v2 keys after the redesign. If
the rollout can safely block new v1 public score writes, do so. If legacy clients
must still be tolerated, v1 writes may remain technically accepted but must be
hidden from redesigned leaderboard views and documented as legacy-only.

## UI Direction

Keep the PokeDex hardware as the outer physical shell, but remove or ignore the
current generic PokeDex/game-device screen theme inside it. The screen should
become a real PokeOS surface: a lightweight operating system for the PokeDex
shell.

PokeOS should look, feel, and operate like a Game Boy Color-era Pokemon menu,
especially the menu/layout rhythm of Pokemon Red, Blue, and Yellow. Use original
CSS and UI assets, not copied game assets.

Suggested PokeOS structure:

- A home/menu surface for Quiz, PokeDex Log, Leaderboard, and Settings.
- A Quiz app with the compact setup ordered as Generation, Questions, Answer,
  Timed, and Leaderboard.
- A run preview/status window that explains eligibility without adding another
  decision.
- A prominent Start Quiz command in the same menu language.
- Secondary actions such as Refresh Data and APK download placed outside the
  primary launch path.

Navigation model:

- After unlock, the PokeDex opens into PokeOS, defaulting to the Quiz app.
- Existing top-level tabs should become PokeOS app/menu entries inside the
  hardware shell, not a separate web-dashboard navigation layer outside it.
- The player can return to the PokeOS home/menu without leaving the hardware
  shell.

Visual and interaction direction:

- Pixel-style bordered windows and dialogue boxes.
- High-contrast, limited-color GBC-inspired palette.
- Menu cursor/selection treatment instead of generic dashboard cards.
- Compact text hierarchy that works inside the hardware screen.
- Simple, snappy state changes rather than heavy animation.
- Outer shell themes affect the physical PokeDex hardware only. PokeOS keeps a
  stable GBC-inspired screen palette unless a future design explicitly adds OS
  themes.

Settings should continue to own trainer identity, avatar, and device shell
theme. Gameplay setup should live in the PokeOS Quiz app.

On mobile, the PokeDex shell may frame the screen, but PokeOS controls should
stack in the same order, keep touch targets at least as large as the existing
button/select controls, and keep Start Quiz visible immediately after the run
preview without requiring the player to scroll past secondary actions.

### PokeOS UI Acceptance

- Use original pixel-style borders, windows, cursor states, and palettes; do not
  copy exact game screens, sprites, fonts, or layout assets from Pokemon titles.
- Selected and disabled states must be visually obvious for Generation,
  Questions, Answer, Timed, and Leaderboard controls.
- Select-like controls should read as PokeOS menus, not native browser dropdowns
  or dashboard form fields.
- Keyboard, pointer, and touch input should share the same selected/focused
  cursor treatment where practical.
- Typed-answer autofill appears as a PokeOS list directly below the input, has a
  bounded height with scrolling for long match lists, and uses touch targets at
  least as large as the answer buttons.
- Session rejection returns to the locked PokeOS state with a clear rejection
  message explaining that the active quiz was closed and rolled back.
- At narrow mobile widths, decorative shell chrome may compress or simplify
  before it makes the PokeOS controls too small or pushes Start Quiz below
  secondary actions.

## Testing And Verification

Pure logic tests should cover:

- Generation pool selection.
- 25, 50, 100, Entire Generation, and All Pokemon question counts.
- Redesigned leaderboard keys.
- Serialized v2 leaderboard-key examples with `gen`, `q`, `total`, and
  `answer` fields.
- Leaderboard eligibility with Google, local trainer, guest, timed, and
  leaderboard toggle combinations.
- Public eligibility snapshotted at quiz start.
- Preference normalization from old settings to redesigned settings.
- Typed and multiple-choice leaderboard separation.
- Question-count disabling or fallback for pools smaller than fixed counts.
- Duplicate fixed/full generation suppression when a generation's full size
  equals a fixed preset.
- Three-attempt scoring and incorrect-question behavior.
- Timer lifecycle for active timed runs.
- Typed-answer autofill matching and no-auto-submit behavior.
- Session rejection and rollback triggers.

Browser/game QA should cover:

- Mobile setup layout.
- Desktop setup layout.
- Starting typed and multiple-choice runs.
- Timed personal-best-only run.
- Timed leaderboard-enabled run with an ineligible local trainer.
- Leaderboard page reflecting the selected setup.
- No colored-image or alternate guess-mode controls visible.
- Leaderboard toggle disabled when Timed is No.
- Local trainer with Leaderboard: Yes clearly showing personal-best-only status.
- All Pokemon forcing personal-best/non-public status.
- Tab/app background rejection.
- Paste/drop rejection in typed-answer mode.
- Rejection message and locked-state return.
- PokeOS menu flow inside the PokeDex hardware shell.

## Implementation Boundaries

Keep the redesign scoped to setup, quiz settings normalization, leaderboard key
shape, eligibility, active-run rollback, anti-cheat triggers, PokeOS UI, and
related tests. Do not refactor authentication, PokeDex entry rendering, APK
packaging, or Firebase schema beyond what the redesigned leaderboard/personal-
score keys require.

The implementation should replace the old setup DOM/state model rather than
depending on hidden legacy controls. Pure helpers should own the redesigned
policy where practical, including quiz-default normalization, question-count
resolution, typed-answer autofill matching, v2 leaderboard-key construction,
and v2 leaderboard eligibility.

Firestore rules should be reviewed for the v2 score shape. If rules cannot
reasonably validate every client-side category rule, the implementation should
document that public score category integrity is primarily client-enforced and
rules enforce ownership and basic score shape.

## Open Assumptions

- "Rules" are design defaults and remain mutable until the implementation plan
  is approved.
- Multiple choice stays available as a simple setup toggle and has separate
  leaderboards from typed answers.
- Public leaderboard submissions remain Google Auth only.
- Active quiz sessions are strict: visibility loss, app backgrounding, or
  pasted/dropped answers reject the run and close the session.
