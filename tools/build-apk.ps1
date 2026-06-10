$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$srcMain = Join-Path $root "android\app\src\main"
$buildRoot = Join-Path $root "android\build"
$downloads = Join-Path $root "downloads"
$finalApk = Join-Path $downloads "whos-that-pokemon.apk"

$androidHome = $env:ANDROID_HOME
if ([string]::IsNullOrWhiteSpace($androidHome)) {
    $androidHome = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
if (-not (Test-Path $androidHome)) {
    throw "Android SDK not found. Set ANDROID_HOME or install the Android SDK."
}

$javaHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($javaHome)) {
    $javaHome = "C:\Program Files\Android\Android Studio\jbr"
}
if (-not (Test-Path $javaHome)) {
    throw "JDK not found. Set JAVA_HOME or install Android Studio's bundled JDK."
}
$env:JAVA_HOME = $javaHome
$env:PATH = (Join-Path $javaHome "bin") + [System.IO.Path]::PathSeparator + $env:PATH

$buildTools = Get-ChildItem (Join-Path $androidHome "build-tools") -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 1
if ($null -eq $buildTools) {
    throw "Android SDK build-tools are missing."
}

$platform = Get-ChildItem (Join-Path $androidHome "platforms") -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 1
if ($null -eq $platform) {
    throw "Android SDK platforms are missing."
}

$androidJar = Join-Path $platform.FullName "android.jar"
$aapt2 = Join-Path $buildTools.FullName "aapt2.exe"
$d8 = Join-Path $buildTools.FullName "d8.bat"
$zipalign = Join-Path $buildTools.FullName "zipalign.exe"
$apksigner = Join-Path $buildTools.FullName "apksigner.bat"
$javac = Join-Path $javaHome "bin\javac.exe"
$jar = Join-Path $javaHome "bin\jar.exe"
$keytool = Join-Path $javaHome "bin\keytool.exe"

foreach ($tool in @($androidJar, $aapt2, $d8, $zipalign, $apksigner, $javac, $jar, $keytool)) {
    if (-not (Test-Path $tool)) {
        throw "Required build tool is missing: $tool"
    }
}

if (Test-Path $buildRoot) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}

$classesDir = Join-Path $buildRoot "classes"
$dexDir = Join-Path $buildRoot "dex"
$genDir = Join-Path $buildRoot "generated"
$compiledRes = Join-Path $buildRoot "compiled-res"
$assetDir = Join-Path $buildRoot "assets"
$keystoreDir = Join-Path $env:USERPROFILE ".android"
$keystore = Join-Path $keystoreDir "debug.keystore"
$unsignedApk = Join-Path $buildRoot "unsigned.apk"
$alignedApk = Join-Path $buildRoot "aligned.apk"
$signedApk = Join-Path $buildRoot "whos-that-pokemon.apk"

New-Item -ItemType Directory -Force -Path $classesDir, $dexDir, $genDir, $compiledRes, $assetDir, $downloads, $keystoreDir | Out-Null

& $aapt2 compile --dir (Join-Path $srcMain "res") -o $compiledRes
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed." }

$flatFiles = Get-ChildItem -Path $compiledRes -Recurse -Filter "*.flat" | ForEach-Object { $_.FullName }
& $aapt2 link `
    -o $unsignedApk `
    --manifest (Join-Path $srcMain "AndroidManifest.xml") `
    -I $androidJar `
    --java $genDir `
    -A $assetDir `
    --min-sdk-version 23 `
    --target-sdk-version 36 `
    --version-code 2 `
    --version-name "2.0" `
    $flatFiles
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed." }

$javaFiles = @(
    Join-Path $srcMain "java\com\twizzy\whosthatpokemon\MainActivity.java"
    Join-Path $genDir "com\twizzy\whosthatpokemon\R.java"
)
& $javac -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath $androidJar -d $classesDir $javaFiles
if ($LASTEXITCODE -ne 0) { throw "javac failed." }

$classFiles = Get-ChildItem -Path $classesDir -Recurse -Filter "*.class" | ForEach-Object { $_.FullName }
& $d8 --min-api 23 --lib $androidJar --output $dexDir $classFiles
if ($LASTEXITCODE -ne 0) { throw "d8 failed." }

& $jar uf $unsignedApk -C $dexDir "classes.dex"
if ($LASTEXITCODE -ne 0) { throw "adding classes.dex failed." }

& $zipalign -f -p 4 $unsignedApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "zipalign failed." }

if (-not (Test-Path $keystore)) {
    & $keytool -genkeypair `
        -keystore $keystore `
        -storepass android `
        -keypass android `
        -alias androiddebugkey `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -dname "CN=Debug,O=Android,C=US" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "keytool failed." }
}

& $apksigner sign `
    --ks $keystore `
    --ks-pass pass:android `
    --key-pass pass:android `
    --ks-key-alias androiddebugkey `
    --out $signedApk `
    $alignedApk
if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed." }

& $apksigner verify --verbose $signedApk
if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed." }

Copy-Item -LiteralPath $signedApk -Destination $finalApk -Force
Write-Host "Built $finalApk"
