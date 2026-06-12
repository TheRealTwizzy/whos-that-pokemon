import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("Android wrapper is a Gradle Firebase app with native auth bridge dependencies", () => {
  const settingsGradle = readText("android/settings.gradle");
  const projectGradle = readText("android/build.gradle");
  const appGradle = readText("android/app/build.gradle");

  assert.match(settingsGradle, /include\s+['"]?:app['"]?/);
  assert.match(projectGradle, /com\.android\.application/);
  assert.match(projectGradle, /com\.google\.gms\.google-services/);
  assert.match(appGradle, /applicationId\s*=\s*['"]com\.twizzy\.whosthatpokemon['"]/);
  assert.match(appGradle, /implementation\s+platform\(['"]com\.google\.firebase:firebase-bom:/);
  assert.match(appGradle, /com\.google\.firebase:firebase-auth/);
  assert.match(appGradle, /androidx\.credentials:credentials/);
  assert.match(appGradle, /androidx\.credentials:credentials-play-services-auth/);
  assert.match(appGradle, /com\.google\.android\.libraries\.identity\.googleid:googleid/);
  assert.match(appGradle, /signingConfigs/);
  assert.match(appGradle, /WTP_RELEASE_STORE_FILE/);
  assert.match(appGradle, /wtp\.release\.storeFile/);
  assert.match(appGradle, /buildTypes/);
  assert.match(appGradle, /release/);
});

test("Android WebView wrapper restricts navigation and exposes native auth only to the trusted app URL", () => {
  const activity = readText("android/app/src/main/java/com/twizzy/whosthatpokemon/MainActivity.java");

  assert.match(activity, /TRUSTED_APP_URL\s*=\s*"https:\/\/therealtwizzy\.github\.io\/whos-that-pokemon\/"/);
  assert.match(activity, /addJavascriptInterface\([^;]+,\s*"PokeNativeAuth"\)/s);
  assert.match(activity, /isTrustedAppUrl/);
  assert.match(activity, /shouldOverrideUrlLoading/);
  assert.match(activity, /MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(activity, /!request\.isForMainFrame\(\)/);
  assert.match(activity, /GoogleIdTokenCredential/);
  assert.match(activity, /GoogleAuthProvider\.getCredential\(idToken,\s*null\)/);
  assert.match(activity, /poke-native-signout-result/);
  assert.match(activity, /clearCredentialStateAsync/);
  assert.doesNotMatch(activity, /loadUrl\([^)]*idToken/);
});

test("Android APK build script publishes release artifacts and keeps debug local-only", () => {
  const script = readText("tools/build-apk.ps1");

  assert.match(script, /\[ValidateSet\("Debug",\s*"Release"\)\]/);
  assert.match(script, /\[string\]\s+\$Variant\s*=\s*"Release"/);
  assert.match(script, /WTP_RELEASE_STORE_FILE/);
  assert.match(script, /release-signing\.properties/);
  assert.match(script, /Debug builds do not overwrite/);
  assert.match(script, /if \(\$Variant -eq "Release"\)/);
  assert.match(script, /Copy-Item -LiteralPath \$builtApk -Destination \$finalApk -Force/);
});

function readText(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}
