import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("PokeDex shell does not render emulated hardware controls or stylus UI", () => {
  assert.equal(indexHtml.includes("data-hardware-action"), false);
  assert.equal(indexHtml.includes("hardware-rail"), false);
  assert.equal(indexHtml.includes("rail-button"), false);
  assert.equal(indexHtml.includes("hardware-dpad"), false);
  assert.equal(indexHtml.includes("stylus-dock"), false);
  assert.equal(indexHtml.includes('class="stylus"'), false);
});
