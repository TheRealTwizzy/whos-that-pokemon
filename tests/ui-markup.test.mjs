import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
const manifestJson = JSON.parse(readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8"));

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

test("site exposes an installable mobile web app manifest", () => {
  assert.equal(indexHtml.includes('rel="manifest"'), true);
  assert.equal(manifestJson.display, "standalone");
  assert.equal(manifestJson.orientation, "landscape");
  assert.equal(manifestJson.icons.some((icon) => icon.src === "icons/pokedex-icon.svg"), true);
});

test("mobile portrait uses auto-rotation instead of an orientation gate", () => {
  assert.equal(appJs.includes("getAutoLandscapeRotation"), true);
  assert.equal(appJs.includes("shouldAutoRotateToLandscape"), true);
  assert.equal(appJs.includes("auto-rotate-landscape"), true);
  assert.equal(stylesCss.includes("var(--device-rotation, 0deg)"), true);
});
