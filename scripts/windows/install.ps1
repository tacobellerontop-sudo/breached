<#
.SYNOPSIS
  Applies the Breached settings pack (M0) to an installed Firefox on Windows.

.DESCRIPTION
  Copies Breached's enterprise policies, preferences and (optionally) the
  minimal UI stylesheet and Tab Sleeper extension into Firefox. Run it again
  after changing anything in config/ or ui/. Undo with uninstall.ps1.

  Close Firefox before running. Writing into "Program Files" needs admin
  rights; the script asks for them when needed.

.PARAMETER Lean
  Also apply Lean mode (fewer processes, weaker isolation between ordinary
  sites). See docs/PLAN.md section 6.

.PARAMETER NoUI
  Skip the minimal UI stylesheet.

.PARAMETER TabSleeperXpi
  Path to a signed Tab Sleeper .xpi. Release Firefox only installs signed
  extensions; see extensions/tab-sleeper/README.md. Defaults to
  dist\tab-sleeper.xpi when that file exists.

.PARAMETER FirefoxDir
  Firefox install folder. Found automatically when omitted.

.PARAMETER ProfilesDir
  Folder holding Firefox profiles. Defaults to %APPDATA%\Mozilla\Firefox\Profiles.
#>
[CmdletBinding()]
param(
  [switch]$Lean,
  [switch]$NoUI,
  [string]$TabSleeperXpi,
  [string]$FirefoxDir,
  [string]$ProfilesDir
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path ([IO.Path]::Combine($PSScriptRoot, '..', '..'))).Path
$Marker = 'Breached'
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Find-FirefoxDir {
  foreach ($root in 'HKLM:\SOFTWARE\Mozilla\Mozilla Firefox', 'HKLM:\SOFTWARE\WOW6432Node\Mozilla\Mozilla Firefox') {
    $current = (Get-ItemProperty -Path $root -ErrorAction SilentlyContinue).CurrentVersion
    if ($current) {
      $dir = (Get-ItemProperty -Path "$root\$current\Main" -ErrorAction SilentlyContinue).'Install Directory'
      if ($dir -and (Test-Path (Join-Path $dir 'firefox.exe'))) { return $dir }
    }
  }
  foreach ($dir in "$env:ProgramFiles\Mozilla Firefox", "${env:ProgramFiles(x86)}\Mozilla Firefox") {
    if ($dir -and (Test-Path (Join-Path $dir 'firefox.exe'))) { return $dir }
  }
  throw 'Could not find Firefox. Install it from https://www.mozilla.org/firefox/ or pass -FirefoxDir.'
}

function Test-Writable([string]$dir) {
  $probe = Join-Path $dir ".breached-write-test-$PID"
  try { [IO.File]::WriteAllText($probe, ''); Remove-Item $probe -Force; return $true } catch { return $false }
}

# Copies a file into place, backing up whatever non-Breached file was there first.
function Install-File([string]$source, [string]$dest, $content) {
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  if ((Test-Path $dest) -and -not (Select-String -Path $dest -Pattern $Marker -SimpleMatch -Quiet)) {
    if (-not (Test-Path "$dest.breached-backup")) {
      Copy-Item $dest "$dest.breached-backup"
      Write-Host "  backed up existing $(Split-Path $dest -Leaf)"
    }
  }
  if ($null -ne $content) { [IO.File]::WriteAllText($dest, $content, $Utf8NoBom) }
  else { Copy-Item $source $dest -Force }
  Write-Host "  wrote $dest"
}

if (-not $FirefoxDir) { $FirefoxDir = Find-FirefoxDir }
if (-not $ProfilesDir) { $ProfilesDir = Join-Path $env:APPDATA 'Mozilla\Firefox\Profiles' }
if (-not $TabSleeperXpi) {
  $default = [IO.Path]::Combine($RepoRoot, 'dist', 'tab-sleeper.xpi')
  if (Test-Path $default) { $TabSleeperXpi = $default }
}

# Re-launch elevated if we can't write into the Firefox folder. Profile paths
# are resolved above, before elevation, so the right user's profiles are used.
if (-not (Test-Writable $FirefoxDir)) {
  if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    Write-Host 'Admin rights are needed to write into the Firefox folder. Asking Windows...'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
      '-FirefoxDir', "`"$FirefoxDir`"", '-ProfilesDir', "`"$ProfilesDir`"")
    if ($Lean) { $argList += '-Lean' }
    if ($NoUI) { $argList += '-NoUI' }
    if ($TabSleeperXpi) { $argList += @('-TabSleeperXpi', "`"$TabSleeperXpi`"") }
    $exe = (Get-Process -Id $PID).Path
    $p = Start-Process -FilePath $exe -ArgumentList $argList -Verb RunAs -Wait -PassThru
    exit $p.ExitCode
  }
  throw "Cannot write to $FirefoxDir."
}

if (Get-Process -Name firefox -ErrorAction SilentlyContinue) {
  throw 'Firefox is running. Close it and run this script again.'
}

Write-Host "Firefox: $FirefoxDir"

# 1. Enterprise policies
$policies = Get-Content ([IO.Path]::Combine($RepoRoot, 'config', 'policies.json')) -Raw | ConvertFrom-Json
if ($TabSleeperXpi) {
  $xpi = (Resolve-Path $TabSleeperXpi).Path
  $xpiDest = [IO.Path]::Combine($FirefoxDir, 'distribution', 'breached', 'tab-sleeper.xpi')
  New-Item -ItemType Directory -Force -Path (Split-Path $xpiDest) | Out-Null
  Copy-Item $xpi $xpiDest -Force
  $xpiUrl = (New-Object System.Uri $xpiDest).AbsoluteUri
  $entry = [pscustomobject]@{
    installation_mode = 'normal_installed'
    install_url       = $xpiUrl
    private_browsing  = $true
  }
  $policies.policies.ExtensionSettings | Add-Member -NotePropertyName 'tab-sleeper@breached' -NotePropertyValue $entry -Force
  Write-Host "  Tab Sleeper: $xpiDest"
} else {
  Write-Host '  Tab Sleeper: skipped (no signed .xpi yet; see extensions/tab-sleeper/README.md)'
}
$policies | Add-Member -NotePropertyName 'x-installed-by' -NotePropertyValue $Marker -Force
Install-File $null ([IO.Path]::Combine($FirefoxDir, 'distribution', 'policies.json')) ($policies | ConvertTo-Json -Depth 20)

# 2. Preferences (autoconfig)
Install-File ([IO.Path]::Combine($RepoRoot, 'config', 'autoconfig.js')) ([IO.Path]::Combine($FirefoxDir, 'defaults', 'pref', 'autoconfig.js')) $null
$cfg = Get-Content ([IO.Path]::Combine($RepoRoot, 'config', 'breached.cfg')) -Raw
if ($Lean) {
  $cfg += Get-Content ([IO.Path]::Combine($RepoRoot, 'config', 'lean.cfg')) -Raw
  Write-Host '  Lean mode: on'
}
Install-File $null (Join-Path $FirefoxDir 'breached.cfg') $cfg

# 3. Minimal UI, per profile
if (-not $NoUI) {
  $profiles = @(Get-ChildItem -Path $ProfilesDir -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName 'prefs.js') })
  if ($profiles.Count -eq 0) {
    Write-Host '  Minimal UI: no profiles yet. Start Firefox once, close it, and run this again.'
  }
  foreach ($profile in $profiles) {
    Install-File ([IO.Path]::Combine($RepoRoot, 'ui', 'userChrome.css')) ([IO.Path]::Combine($profile.FullName, 'chrome', 'userChrome.css')) $null
  }
}

Write-Host ''
Write-Host 'Done. Start Firefox; about:policies should list the Breached policies.'
Write-Host 'If a Firefox update ever removes them, run this script again.'
