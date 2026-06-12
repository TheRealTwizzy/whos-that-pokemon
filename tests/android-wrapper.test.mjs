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
  assert.match(script, /Copy-Item -LiteralPath \$builtApk -Destination \$stableApk -Force/);
});

test("Android updater manifest publishes the required release APK metadata", () => {
  const manifest = readJson("android-update.json");

  assert.equal(manifest.packageName, "com.twizzy.whosthatpokemon");
  assert.equal(manifest.versionCode, 6);
  assert.equal(manifest.versionName, "6.0");
  assert.equal(manifest.minimumVersionCode, 6);
  assert.equal(manifest.required, true);
  assert.equal(
    manifest.apkUrl,
    "https://therealtwizzy.github.io/whos-that-pokemon/downloads/whos-that-pokemon.apk",
  );
  assert.equal(manifest.apkFileName, "whos-that-pokemon-v6.0.apk");
  assert.equal(manifest.stableApkFileName, "whos-that-pokemon.apk");
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
});

test("Android release build is versioned for the first boot-up updater client", () => {
  const appGradle = readText("android/app/build.gradle");

  assert.match(appGradle, /versionCode\s*=\s*6/);
  assert.match(appGradle, /versionName\s*=\s*['"]6\.0['"]/);
  assert.match(appGradle, /buildConfig\s*=\s*true/);
});

test("Android wrapper can install verified sideload APK updates", () => {
  const manifest = readText("android/app/src/main/AndroidManifest.xml");
  const providerPaths = readText("android/app/src/main/res/xml/apk_update_paths.xml");
  const activity = readText("android/app/src/main/java/com/twizzy/whosthatpokemon/MainActivity.java");

  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /androidx\.core\.content\.FileProvider/);
  assert.match(manifest, /android:authorities="\$\{applicationId\}\.apkprovider"/);
  assert.match(providerPaths, /<cache-path[^>]+path="updates\/"/);
  assert.match(activity, /UPDATE_MANIFEST_URL/);
  assert.match(activity, /android-update\.json/);
  assert.match(activity, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(activity, /getPackageArchiveInfo/);
  assert.match(activity, /GET_SIGNING_CERTIFICATES/);
  assert.match(activity, /EXPECTED_RELEASE_CERT_SHA256/);
  assert.match(activity, /getLongVersionCode/);
  assert.match(activity, /signingInfo/);
  assert.match(activity, /FileProvider\.getUriForFile/);
  assert.match(activity, /ACTION_INSTALL_PACKAGE/);
  assert.match(activity, /INSTALL_UPDATE_REQUEST_CODE/);
  assert.match(activity, /onActivityResult/);
  assert.match(activity, /showInstallNotCompletedFallback/);
  assert.match(activity, /ACTION_APPLICATION_DETAILS_SETTINGS/);
  assert.match(activity, /Open App Settings/);
  assert.match(activity, /application\/vnd\.android\.package-archive/);
  assert.match(activity, /canRequestPackageInstalls/);
  assert.match(activity, /getVersionInfo\(\)/);
  assert.match(activity, /BuildConfig\.VERSION_CODE/);
});

test("Android wrapper checks for required updates before loading the trusted WebView", () => {
  const activity = readText("android/app/src/main/java/com/twizzy/whosthatpokemon/MainActivity.java");
  const checkIndex = activity.indexOf("checkForUpdatesThenBoot()");
  const loadIndex = activity.indexOf("webView.loadUrl(TRUSTED_APP_URL)");

  assert.notEqual(checkIndex, -1);
  assert.notEqual(loadIndex, -1);
  assert.ok(checkIndex < loadIndex);
});

test("Android build script refreshes the update manifest from the signed release APK", () => {
  const script = readText("tools/build-apk.ps1");

  assert.match(script, /\$updateManifest/);
  assert.match(script, /android-update\.json/);
  assert.match(script, /Get-FileHash -Algorithm SHA256/);
  assert.match(script, /minimumVersionCode/);
  assert.match(script, /https:\/\/therealtwizzy\.github\.io\/whos-that-pokemon\/downloads/);
  assert.match(script, /\$stablePublicApkUrl = "\$publicDownloadsUrl\/\$stableApkFileName"/);
  assert.match(script, /whos-that-pokemon-v\$safeVersionName\.apk/);
  assert.match(script, /Browser download file name/);
});

function readText(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}
