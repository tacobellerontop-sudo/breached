# Builds the portable Breached app for Windows from Mozilla's prebuilt Gecko.
#
#   pwsh scripts/build/package-shell.ps1 -Installer "Firefox Setup 158.0.1.exe" -Out out
#
# Takes the engine (xul.dll, the Gecko runtime files) out of the official
# Firefox installer, drops Firefox's own front end (browser\) and its helper
# programs, and adds the Breached shell from shell\. Result: <Out>\breached\
# with Breached.bat to start it. Needs 7-Zip (7z) and Python 3 on PATH.

param(
    [Parameter(Mandatory)] [string] $Installer,
    [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\..\.."

$extract = Join-Path $Out 'extract'
$app = Join-Path $Out 'breached'
Remove-Item -Recurse -Force $extract, $app -ErrorAction SilentlyContinue
& 7z x $Installer "-o$extract" -y | Out-Null
if ($LASTEXITCODE) { throw "7z failed on $Installer" }
Move-Item (Join-Path $extract 'core') $app

# Firefox's front end and the background helpers Breached doesn't use.
$drop = @(
    'browser', 'uninstall', 'distribution',
    'default-browser-agent.exe', 'maintenanceservice.exe', 'maintenanceservice_installer.exe',
    'updater.exe', 'updater.ini', 'update-settings.ini', 'pingsender.exe',
    'private_browsing.exe', 'private_browsing.VisualElementsManifest.xml',
    'crashreporter.exe', 'crashhelper.exe', 'minidump-analyzer.exe', 'nmhproxy.exe',
    'firefox.VisualElementsManifest.xml', 'precomplete', 'removed-files'
)
foreach ($name in $drop) {
    Remove-Item -Recurse -Force (Join-Path $app $name) -ErrorAction SilentlyContinue
}

# The shell, with config/breached.cfg baked in as defaults.
Copy-Item -Recurse (Join-Path $repo 'shell') (Join-Path $app 'breached')
& python (Join-Path $repo 'scripts/build/cfg-to-prefs.py') (Join-Path $app 'breached/defaults/preferences/breached.js')
if ($LASTEXITCODE) { throw 'cfg-to-prefs failed' }

# Portable: the profile lives next to the app, separate from any Firefox.
$bat = '@start "" "%~dp0firefox.exe" -app "%~dp0breached\application.ini" -profile "%~dp0profile" -no-remote %*'
Set-Content (Join-Path $app 'Breached.bat') $bat -Encoding ascii
New-Item -ItemType Directory -Force (Join-Path $app 'profile') | Out-Null

Remove-Item -Recurse -Force $extract
$size = (Get-ChildItem -Recurse $app | Measure-Object Length -Sum).Sum / 1MB
"Breached app at $app ({0:N0} MB)" -f $size
