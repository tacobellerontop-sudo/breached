# Builds the portable Breached app for Windows from Mozilla's prebuilt Gecko.
#
#   pwsh scripts/build/package-shell.ps1 -Installer "Firefox Setup 158.0.1.exe" -Out out
#
# -Installer can also be the zip from our own Gecko build (build-gecko.yml).
#
# Takes the engine (xul.dll, the Gecko runtime files) out of the official
# Firefox installer, drops Firefox's own front end (browser\) and its helper
# programs, renames firefox.exe to breached.exe, and adds the Breached shell
# from shell\. Result: <Out>\breached\ with Breached.bat to start it as a
# portable app. On our own Gecko build breached.exe also starts the shell by
# itself (gecko/patches). Needs 7-Zip (7z) and Python 3 on PATH.

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
# Mozilla's installer keeps the files in core\; our own Gecko build's zip in firefox\.
$engine = @('core', 'firefox') | ForEach-Object { Join-Path $extract $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $engine) { throw "no engine folder in $Installer" }
Move-Item $engine $app

# Firefox's front end and the background helpers Breached doesn't use.
$drop = @(
    'browser', 'uninstall', 'distribution',
    'default-browser-agent.exe', 'maintenanceservice.exe', 'maintenanceservice_installer.exe',
    'updater.exe', 'updater.ini', 'update-settings.ini', 'pingsender.exe',
    'private_browsing.exe', 'private_browsing.VisualElementsManifest.xml',
    'crashreporter.exe', 'crashhelper.exe', 'minidump-analyzer.exe', 'nmhproxy.exe',
    'firefox.VisualElementsManifest.xml', 'precomplete', 'removed-files',
    # Firefox's own emoji font: Windows' Segoe UI Emoji is already loaded by
    # the system (see font.name-list.emoji). The ClearKey test media plugin.
    'fonts', 'gmp-clearkey'
)
foreach ($name in $drop) {
    Remove-Item -Recurse -Force (Join-Path $app $name) -ErrorAction SilentlyContinue
}

# The engine's program is breached.exe. Gecko starts its child processes from
# its own path, so the name doesn't matter to it.
Rename-Item (Join-Path $app 'firefox.exe') 'breached.exe'

# The shell, with config/breached.cfg baked in as defaults.
Copy-Item -Recurse (Join-Path $repo 'shell') (Join-Path $app 'breached')
& python (Join-Path $repo 'scripts/build/cfg-to-prefs.py') (Join-Path $app 'breached/defaults/preferences/breached.js')
if ($LASTEXITCODE) { throw 'cfg-to-prefs failed' }

# Portable: the profile lives next to the app, separate from any Firefox.
$bat = '@start "" "%~dp0breached.exe" -app "%~dp0breached\application.ini" -profile "%~dp0profile" -no-remote %*'
Set-Content (Join-Path $app 'Breached.bat') $bat -Encoding ascii
New-Item -ItemType Directory -Force (Join-Path $app 'profile') | Out-Null

Remove-Item -Recurse -Force $extract
$size = (Get-ChildItem -Recurse $app | Measure-Object Length -Sum).Sum / 1MB
"Breached app at $app ({0:N0} MB)" -f $size
