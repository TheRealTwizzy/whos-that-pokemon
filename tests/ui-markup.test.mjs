import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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
const root = fileURLToPath(new URL("..", import.meta.url));

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
  assert.equal(indexHtml.includes('id="version-status"'), true);
  assert.equal(indexHtml.includes('id="settings-version-status"'), true);
  assert.equal(indexHtml.includes('download="whos-that-pokemon-v6.0.apk"'), true);
  assert.equal(indexHtml.includes('id="apk-reinstall-version"'), true);
  assert.equal(indexHtml.includes('id="apk-reinstall-prompt"'), true);
  assert.equal(indexHtml.includes("uninstall the old APK"), true);
  assert.equal(indexHtml.includes("App not installed"), true);
  assert.equal(indexHtml.includes("PokeOS version-mismatch"), true);
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
  assert.equal(serviceWorkerJs.includes("const CACHE_NAME = `${CACHE_PREFIX}v6`;"), true);
  assert.equal(serviceWorkerJs.includes("key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME"), true);
  assert.equal(serviceWorkerJs.includes('self.clients.matchAll({ type: "window" })'), true);
  assert.equal(serviceWorkerJs.includes("client.navigate(client.url)"), true);
});

test("web app blocks outdated native Android wrappers before login", () => {
  assert.equal(appJs.includes("ANDROID_UPDATE_MANIFEST_URL"), true);
  assert.equal(appJs.includes("MIN_NATIVE_WRAPPER_VERSION_CODE"), true);
  assert.equal(appJs.includes("resolveNativeWrapperUpdateGate"), true);
  assert.equal(appJs.includes("nativeUpdateGate"), true);
  assert.equal(appJs.includes("Android app update required"), true);
  assert.equal(appJs.includes("downloads/whos-that-pokemon.apk"), true);
  assert.equal(appJs.includes("whos-that-pokemon-v6.0.apk"), true);
  assert.equal(appJs.includes("renderVersionStatus"), true);
  assert.equal(appJs.includes("Client APK"), true);
  assert.equal(appJs.includes("Latest APK"), true);
  assert.equal(appJs.includes("isNativeWrapperUpdateRequired"), true);
  assert.equal(appJs.includes("showApkReinstallPrompt"), true);
  assert.equal(appJs.includes("startApkDownload"), true);
  assert.equal(appJs.includes("pendingApkDownloadUrl"), true);
  assert.equal(appJs.includes("pendingApkDownloadName"), true);
  assert.equal(stylesCss.includes(".version-status"), true);
  assert.equal(stylesCss.includes(".apk-reinstall-prompt"), true);
  assert.equal(stylesCss.includes(".apk-reinstall-card"), true);
});

test("APK download flow shows current/latest versions and saves a versioned file name", async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 932, height: 430 } });
  const page = await context.newPage();

  try {
    await page.goto(`http://127.0.0.1:${server.port}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#version-status")?.textContent.includes("Latest APK v6.0"));

    const linkState = await page.evaluate(() => {
      const link = document.querySelector(".download-link");
      return {
        href: link.getAttribute("href"),
        download: link.getAttribute("download"),
        versionText: document.querySelector("#version-status").textContent.trim(),
      };
    });

    assert.equal(linkState.href, "downloads/whos-that-pokemon.apk");
    assert.equal(linkState.download, "whos-that-pokemon-v6.0.apk");
    assert.equal(linkState.versionText, "Client Web v6.0 (6) | Latest APK v6.0 (6)");

    await page.click(".download-link");
    await page.waitForSelector("#apk-reinstall-prompt:not(.hidden)");
    assert.equal(
      await page.locator("#apk-reinstall-version").textContent(),
      "Latest APK v6.0 (6) | File: whos-that-pokemon-v6.0.apk",
    );

    const downloadPromise = page.waitForEvent("download");
    await page.click("#apk-reinstall-confirm");
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "whos-that-pokemon-v6.0.apk");
  } finally {
    await browser.close();
    await server.close();
  }
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

function startStaticServer() {
  const contentTypes = new Map([
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".mjs", "text/javascript; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".webmanifest", "application/manifest+json; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".apk", "application/vnd.android.package-archive"],
  ]);

  const server = createServer((request, response) => {
    const rawPath = new URL(request.url, "http://127.0.0.1").pathname;
    const safePath = normalize(decodeURIComponent(rawPath)).replace(/^([/\\])+/, "");
    const filePath = join(root, safePath || "index.html");

    if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    response.writeHead(200, { "Content-Type": contentTypes.get(extname(filePath)) || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => error ? closeReject(error) : closeResolve());
        }),
      });
    });
  });
}

test("Android wrapper uses fullscreen landscape app chrome", () => {
  assert.equal(androidManifest.includes('android:screenOrientation="sensorLandscape"'), true);
  assert.equal(androidMainActivity.includes("SCREEN_ORIENTATION_SENSOR_LANDSCAPE"), true);
  assert.equal(androidMainActivity.includes("hideSystemUi()"), true);
  assert.equal(androidMainActivity.includes("WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars()"), true);
  assert.equal(androidMainActivity.includes("SYSTEM_UI_FLAG_IMMERSIVE_STICKY"), true);
});
