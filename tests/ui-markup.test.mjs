import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
const serviceWorkerJs = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
const manifestJson = JSON.parse(readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
const androidManifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const androidMainActivity = readFileSync(
  new URL("../android/app/src/main/java/com/twizzy/whosthatpokemon/MainActivity.java", import.meta.url),
  "utf8",
);

test("PokeDex shell does not render emulated hardware controls or stylus UI", () => {
  assert.equal(indexHtml.includes("data-hardware-action"), false);
  assert.equal(indexHtml.includes("hardware-rail"), false);
  assert.equal(indexHtml.includes("rail-button"), false);
  assert.equal(indexHtml.includes("hardware-dpad"), false);
  assert.equal(indexHtml.includes("stylus-dock"), false);
  assert.equal(indexHtml.includes('class="stylus"'), false);
});

test("PokeOS command menu does not ship a blocking splash prompt", () => {
  assert.equal(indexHtml.includes("Command Menu"), false);
  assert.equal(indexHtml.includes("Choose a program"), false);
});

test("hardware shell keeps visible account and status information inside PokeOS", () => {
  assert.equal(indexHtml.includes("PokéOS Handheld"), false);
  assert.equal(indexHtml.includes("Guest mode loading"), false);
  assert.equal(indexHtml.includes("orientation-gate"), false);
  assert.equal(indexHtml.includes("Rotate Device"), false);
  assert.equal(indexHtml.includes("Turn your phone"), false);
  assert.equal(stylesCss.includes("@media (orientation: portrait) and (max-width: 760px)"), false);
  assert.equal(stylesCss.includes(".trainer-badge {\n  min-width: 150px;\n  display: none;"), true);
  assert.equal(stylesCss.includes(".auth-panel {\n  display: none;"), true);
  assert.equal(stylesCss.includes(".screen-status {\n  display: none;"), true);
});

test("PokeOS contains account, install, fullscreen, and rights surfaces", () => {
  assert.equal(indexHtml.includes('id="os-account-panel"'), true);
  assert.equal(indexHtml.includes('id="os-account-name"'), true);
  assert.equal(indexHtml.includes('data-lcd-fullscreen'), true);
  assert.equal(indexHtml.includes('data-install-app'), true);
  assert.equal(indexHtml.includes("downloads/whos-that-pokemon.apk"), true);
  assert.equal(indexHtml.includes("Nintendo/Creatures Inc./GAME FREAK inc."), true);
});

test("quiz surface includes visible quit action and PokeOS keyboard", () => {
  assert.equal(indexHtml.includes('id="restart-button"'), true);
  assert.equal(indexHtml.includes('id="poke-keyboard"'), true);
  assert.equal(indexHtml.includes('aria-label="PokéOS keyboard"'), true);
  assert.equal(stylesCss.includes(".quiz-actions #restart-button {\n  display: none;"), false);
  assert.equal(stylesCss.includes(".poke-keyboard"), true);
  assert.equal(appJs.includes("POKE_KEYBOARD_ROWS"), true);
  assert.equal(appJs.includes("handlePokeKeyboardKeyDown"), true);
  assert.equal(appJs.includes("inputmode\", \"none\""), true);
});

test("PokeOS keyboard compact layout protects mobile portrait controls", () => {
  assert.equal(stylesCss.includes(".quiz-panel.poke-keyboard-active .art-panel {\n  height: 76px;"), true);
  assert.equal(stylesCss.includes(".quiz-panel.poke-keyboard-active #pokemon-art {\n  max-height: 70px;"), true);
  assert.equal(stylesCss.includes(".quiz-panel.poke-keyboard-active .autofill-list {\n  display: none;"), true);
  assert.equal(stylesCss.includes(".quiz-panel.poke-keyboard-active .message {\n  min-height: 18px;"), true);
  assert.equal(stylesCss.includes(".quiz-panel.poke-keyboard-active .quiz-actions button {\n  min-height: 24px;"), true);
});

test("site exposes an installable mobile web app manifest", () => {
  assert.equal(indexHtml.includes('rel="manifest"'), true);
  assert.equal(indexHtml.includes("viewport-fit=cover"), true);
  assert.equal(manifestJson.display, "standalone");
  assert.deepEqual(manifestJson.display_override, ["fullscreen", "standalone"]);
  assert.equal(manifestJson.orientation, "landscape");
  assert.equal(manifestJson.icons.some((icon) => icon.src === "icons/pokedex-icon.svg"), true);
});

test("service worker cache version refreshes deployed PokeOS clients", () => {
  assert.equal(serviceWorkerJs.includes('const CACHE_PREFIX = "pokedex-trainer-os-";'), true);
  assert.equal(serviceWorkerJs.includes("const CACHE_NAME = `${CACHE_PREFIX}v4`;"), true);
  assert.equal(serviceWorkerJs.includes("key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME"), true);
  assert.equal(serviceWorkerJs.includes('self.clients.matchAll({ type: "window" })'), true);
  assert.equal(serviceWorkerJs.includes("client.navigate(client.url)"), true);
});

test("mobile portrait uses stable landscape fitting instead of an orientation gate", () => {
  assert.equal(appJs.includes("getFixedLandscapeTransform"), true);
  assert.equal(appJs.includes("resolveStableLandscapeViewport"), true);
  assert.equal(appJs.includes("getShellRotation"), true);
  assert.equal(appJs.includes("function shouldUseFixedLandscapeRotation"), true);
  assert.equal(appJs.includes("function isMobileAppViewport"), true);
  assert.equal(appJs.includes("function getSafeAreaInsets"), true);
  assert.equal(appJs.includes("safeAreaTop: parseCssPixels(style.paddingTop)"), true);
  assert.equal(appJs.includes("lcdOnlyMode: shouldStartInLcdOnlyMode()"), true);
  assert.equal(appJs.includes("function shouldStartInLcdOnlyMode()"), true);
  assert.equal(appJs.includes("scheduleFitDeviceToViewport"), true);
  assert.equal(appJs.includes("visualViewport?.addEventListener"), true);
  assert.equal(stylesCss.includes("var(--device-rotation, 0deg)"), true);
  assert.equal(stylesCss.includes("left: var(--device-offset-x, 0px)"), true);
  assert.equal(stylesCss.includes("html.lcd-only-mode .lock-screen"), true);
  assert.equal(stylesCss.includes("grid-template-columns: minmax(150px, 0.65fr) minmax(0, 1.35fr) !important;"), true);
  assert.equal(stylesCss.includes("100dvh"), true);
  assert.equal(stylesCss.includes("overscroll-behavior: none"), true);
  assert.equal(stylesCss.includes("@media (orientation: landscape) and (max-height: 620px)"), false);
});

test("Android wrapper uses fullscreen landscape app chrome", () => {
  assert.equal(androidManifest.includes('android:screenOrientation="sensorLandscape"'), true);
  assert.equal(androidMainActivity.includes("SCREEN_ORIENTATION_SENSOR_LANDSCAPE"), true);
  assert.equal(androidMainActivity.includes("hideSystemUi()"), true);
  assert.equal(androidMainActivity.includes("WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars()"), true);
  assert.equal(androidMainActivity.includes("SYSTEM_UI_FLAG_IMMERSIVE_STICKY"), true);
});
