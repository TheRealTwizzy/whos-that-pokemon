param(
    [ValidateSet("Debug")]
    [string] $Variant = "Debug"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidRoot = Join-Path $root "android"
$downloads = Join-Path $root "downloads"
$finalApk = Join-Path $downloads "whos-that-pokemon.apk"
$gradleVersion = "8.13"

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

Push-Location $androidRoot
try {
    & $gradleCommand @gradleArgs ":app:assemble$Variant"
    if ($LASTEXITCODE -ne 0) { throw "Gradle assemble$Variant failed." }
} finally {
    Pop-Location
}

$variantLower = $Variant.ToLowerInvariant()
$builtApk = Join-Path $androidRoot "app\build\outputs\apk\$variantLower\app-$variantLower.apk"
if (-not (Test-Path $builtApk)) {
    throw "Gradle did not write the expected APK: $builtApk"
}

Copy-Item -LiteralPath $builtApk -Destination $finalApk -Force
Write-Host "Built $finalApk"

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
