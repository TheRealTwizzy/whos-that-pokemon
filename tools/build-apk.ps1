param(
    [ValidateSet("Debug", "Release")]
    [string] $Variant = "Release"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidRoot = Join-Path $root "android"
$downloads = Join-Path $root "downloads"
$finalApk = Join-Path $downloads "whos-that-pokemon.apk"
$updateManifestPath = Join-Path $root "android-update.json"
$publicApkUrl = "https://therealtwizzy.github.io/whos-that-pokemon/downloads/whos-that-pokemon.apk"
$gradleVersion = "8.13"
$releaseSigningFile = Join-Path $androidRoot "release-signing.properties"
$releaseSigningProperties = @{}
if (Test-Path $releaseSigningFile) {
    $releaseSigningProperties = Get-Content -LiteralPath $releaseSigningFile -Raw | ConvertFrom-StringData
}

function Get-SigningValue {
    param([string[]] $Names)

    foreach ($name in $Names) {
        $envValue = [Environment]::GetEnvironmentVariable($name)
        if (-not [string]::IsNullOrWhiteSpace($envValue)) {
            return $envValue.Trim()
        }
    }

    foreach ($name in $Names) {
        $fileValue = $releaseSigningProperties[$name]
        if (-not [string]::IsNullOrWhiteSpace($fileValue)) {
            return $fileValue.Trim()
        }
    }

    return ""
}

function Get-AndroidAppVersion {
    $appGradle = Join-Path $androidRoot "app\build.gradle"
    $gradleText = Get-Content -LiteralPath $appGradle -Raw
    $versionCodeMatch = [regex]::Match($gradleText, "versionCode\s*=\s*(\d+)")
    $versionNameMatch = [regex]::Match($gradleText, "versionName\s*=\s*['""]([^'""]+)['""]")

    if (-not $versionCodeMatch.Success) {
        throw "Could not read Android versionCode from $appGradle."
    }
    if (-not $versionNameMatch.Success) {
        throw "Could not read Android versionName from $appGradle."
    }

    return [pscustomobject]@{
        VersionCode = [int] $versionCodeMatch.Groups[1].Value
        VersionName = $versionNameMatch.Groups[1].Value
    }
}

$androidHome = $env:ANDROID_HOME
if ([string]::IsNullOrWhiteSpace($androidHome)) {
    $androidHome = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
if (-not (Test-Path $androidHome)) {
    throw "Android SDK not found. Set ANDROID_HOME or install the Android SDK."
}
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome

$javaHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($javaHome)) {
    $studioJbr = "C:\Program Files\Android\Android Studio\jbr"
    if (Test-Path $studioJbr) {
        $javaHome = $studioJbr
    }
}
if (-not [string]::IsNullOrWhiteSpace($javaHome)) {
    $env:JAVA_HOME = $javaHome
    $env:PATH = (Join-Path $javaHome "bin") + [System.IO.Path]::PathSeparator + $env:PATH
}

$gradlew = Join-Path $androidRoot "gradlew.bat"
$gradleCommand = $null
$gradleArgs = @()
if (Test-Path $gradlew) {
    $gradleCommand = $gradlew
} else {
    $systemGradle = Get-Command gradle -ErrorAction SilentlyContinue
    if ($null -ne $systemGradle) {
        $gradleCommand = $systemGradle.Source
    } else {
        $localGradleRoot = Join-Path $root ".gradle\local"
        $localGradleHome = Join-Path $localGradleRoot "gradle-$gradleVersion"
        $localGradle = Join-Path $localGradleHome "bin\gradle.bat"
        if (-not (Test-Path $localGradle)) {
            New-Item -ItemType Directory -Force -Path $localGradleRoot | Out-Null
            $zipPath = Join-Path $localGradleRoot "gradle-$gradleVersion-bin.zip"
            if (-not (Test-Path $zipPath)) {
                $gradleUrl = "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip"
                Write-Host "Downloading Gradle $gradleVersion to repo-local cache..."
                Invoke-WebRequest -Uri $gradleUrl -OutFile $zipPath
            }
            Write-Host "Extracting Gradle $gradleVersion..."
            Expand-Archive -LiteralPath $zipPath -DestinationPath $localGradleRoot -Force
        }
        $gradleCommand = $localGradle
    }
}

if ($null -eq $gradleCommand) {
    throw "Gradle was not found and repo-local Gradle could not be prepared."
}

New-Item -ItemType Directory -Force -Path $downloads | Out-Null

$variantLower = $Variant.ToLowerInvariant()
if ($Variant -eq "Release") {
    $releaseStoreFile = Get-SigningValue @(
        "WTP_RELEASE_STORE_FILE",
        "wtp.release.storeFile",
        "POKE_RELEASE_STORE_FILE",
        "ANDROID_KEYSTORE_PATH"
    )
    $releaseStorePassword = Get-SigningValue @(
        "WTP_RELEASE_STORE_PASSWORD",
        "wtp.release.storePassword",
        "POKE_RELEASE_STORE_PASSWORD",
        "ANDROID_KEYSTORE_PASSWORD"
    )
    $releaseKeyAlias = Get-SigningValue @(
        "WTP_RELEASE_KEY_ALIAS",
        "wtp.release.keyAlias",
        "POKE_RELEASE_KEY_ALIAS",
        "ANDROID_KEY_ALIAS"
    )
    $releaseKeyPassword = Get-SigningValue @(
        "WTP_RELEASE_KEY_PASSWORD",
        "wtp.release.keyPassword",
        "POKE_RELEASE_KEY_PASSWORD",
        "ANDROID_KEY_PASSWORD"
    )

    $missingReleaseSigning = @()
    if ([string]::IsNullOrWhiteSpace($releaseStoreFile)) { $missingReleaseSigning += "store file" }
    if ([string]::IsNullOrWhiteSpace($releaseStorePassword)) { $missingReleaseSigning += "store password" }
    if ([string]::IsNullOrWhiteSpace($releaseKeyAlias)) { $missingReleaseSigning += "key alias" }
    if ([string]::IsNullOrWhiteSpace($releaseKeyPassword)) { $missingReleaseSigning += "key password" }

    if ($missingReleaseSigning.Count -gt 0) {
        throw "Release signing is required before publishing downloads\whos-that-pokemon.apk. Missing: $($missingReleaseSigning -join ', '). Set WTP_RELEASE_STORE_FILE, WTP_RELEASE_STORE_PASSWORD, WTP_RELEASE_KEY_ALIAS, and WTP_RELEASE_KEY_PASSWORD, or create ignored android\release-signing.properties. Use -Variant Debug for local test APKs."
    }

    $releaseStorePath = if ([System.IO.Path]::IsPathRooted($releaseStoreFile)) {
        $releaseStoreFile
    } else {
        Join-Path $androidRoot $releaseStoreFile
    }
    if (-not (Test-Path $releaseStorePath)) {
        throw "Release keystore was not found: $releaseStorePath"
    }
}

Push-Location $androidRoot
try {
    & $gradleCommand @gradleArgs ":app:assemble$Variant"
    if ($LASTEXITCODE -ne 0) { throw "Gradle assemble$Variant failed." }
} finally {
    Pop-Location
}

$builtApk = Join-Path $androidRoot "app\build\outputs\apk\$variantLower\app-$variantLower.apk"
if (-not (Test-Path $builtApk)) {
    throw "Gradle did not write the expected APK: $builtApk"
}

if ($Variant -eq "Release") {
    Copy-Item -LiteralPath $builtApk -Destination $finalApk -Force
    $appVersion = Get-AndroidAppVersion
    $apkSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $finalApk).Hash.ToLowerInvariant()
    $updateManifest = [ordered]@{
        packageName = "com.twizzy.whosthatpokemon"
        versionCode = $appVersion.VersionCode
        versionName = $appVersion.VersionName
        minimumVersionCode = $appVersion.VersionCode
        required = $true
        apkUrl = $publicApkUrl
        sha256 = $apkSha256
    }
    $updateManifestJson = ($updateManifest | ConvertTo-Json -Depth 3) + [Environment]::NewLine
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($updateManifestPath, $updateManifestJson, $utf8NoBom)
    Write-Host "Built release APK: $finalApk"
    Write-Host "Updated Android updater manifest: $updateManifestPath"
} else {
    Write-Host "Built local debug APK: $builtApk"
    Write-Host "Debug builds do not overwrite the public downloads\whos-that-pokemon.apk artifact."
}

$debugKeystore = Join-Path $env:USERPROFILE ".android\debug.keystore"
$keytool = if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    Join-Path $env:JAVA_HOME "bin\keytool.exe"
} else {
    "keytool"
}

if (Test-Path $debugKeystore) {
    Write-Host ""
    Write-Host "Firebase debug fingerprints for package com.twizzy.whosthatpokemon:"
    & $keytool -list -v `
        -keystore $debugKeystore `
        -storepass android `
        -alias androiddebugkey |
        Select-String -Pattern "SHA1:|SHA256:" |
        ForEach-Object { Write-Host $_.Line.Trim() }
}

$googleServices = Join-Path $androidRoot "app\google-services.json"
if (Test-Path $googleServices) {
    try {
        $googleServicesJson = Get-Content -LiteralPath $googleServices -Raw | ConvertFrom-Json
        $androidOauthClients = @(
            $googleServicesJson.client |
                ForEach-Object { $_.oauth_client } |
                Where-Object { $_.client_type -eq 1 }
        )
        if ($androidOauthClients.Count -eq 0) {
            Write-Warning "android/app/google-services.json has no Android OAuth client (client_type 1). Add the debug/release SHA-1 and SHA-256 fingerprints in Firebase for com.twizzy.whosthatpokemon, then re-download google-services.json before testing native Google login."
        }
    } catch {
        Write-Warning "Could not inspect android/app/google-services.json for Android OAuth clients: $($_.Exception.Message)"
    }
}
