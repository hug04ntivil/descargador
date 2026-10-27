# Compila el APK firmado de Descargador para Android.
#   powershell -File android\build-apk.ps1            -> APK de lanzamiento (firmado)
#   powershell -File android\build-apk.ps1 -Debug     -> APK de depuración
# Usa el JDK/SDK locales de ..\.android-tools si existen; si no, JAVA_HOME / ANDROID_HOME del sistema.
param([switch]$Debug)
$ErrorActionPreference = 'Stop'

$proj = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $proj '.android-tools'

if (Test-Path $tools) {
    $jdk = Get-ChildItem $tools -Directory -Filter 'jdk-17*' | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
    $env:ANDROID_HOME = Join-Path $tools 'sdk'
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $env:GRADLE_USER_HOME = Join-Path $tools 'gradle-home'
}
if (-not $env:JAVA_HOME) { throw 'Falta JAVA_HOME (JDK 17).' }
if (-not $env:ANDROID_HOME) { throw 'Falta ANDROID_HOME (Android SDK).' }
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

$gradle = Join-Path $PSScriptRoot 'gradlew.bat'
if (-not (Test-Path $gradle)) { $gradle = (Get-ChildItem $tools -Directory -Filter 'gradle-*' | Select-Object -First 1).FullName + '\bin\gradle.bat' }

$task = if ($Debug) { ':app:assembleDebug' } else { ':app:assembleRelease' }
Push-Location $PSScriptRoot
try { & $gradle --console=plain $task } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "Gradle falló ($LASTEXITCODE)" }

$variant = if ($Debug) { 'debug' } else { 'release' }
$out = Join-Path $proj 'installer'
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem $out -Filter 'Descargador-Android-*.apk' | Remove-Item -Force
foreach ($apk in Get-ChildItem (Join-Path $PSScriptRoot "app\build\outputs\apk\$variant") -Filter '*.apk') {
    # app-universal-release.apk -> Descargador-Android-universal.apk, app-arm64-v8a-release.apk -> ...-arm64-v8a.apk
    $abi = $apk.BaseName -replace '^app-', '' -replace "-$variant$", ''
    $suffix = if ($Debug) { "$abi-debug" } else { $abi }
    $dest = Join-Path $out "Descargador-Android-$suffix.apk"
    Copy-Item $apk.FullName $dest -Force
    Write-Host ("APK listo: {0} ({1:N0} MB)" -f $dest, ($apk.Length / 1MB))
}
