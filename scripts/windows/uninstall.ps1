<#
.SYNOPSIS
  Removes the Breached settings pack from Firefox and restores any files it backed up.
#>
[CmdletBinding()]
param(
  [string]$FirefoxDir,
  [string]$ProfilesDir
)

$ErrorActionPreference = 'Stop'
$Marker = 'Breached'

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
  throw 'Could not find Firefox. Pass -FirefoxDir.'
}

function Test-Writable([string]$dir) {
  $probe = Join-Path $dir ".breached-write-test-$PID"
  try { [IO.File]::WriteAllText($probe, ''); Remove-Item $probe -Force; return $true } catch { return $false }
}

# Deletes a file Breached wrote and puts back the backup, if there is one.
function Remove-BreachedFile([string]$path) {
  if ((Test-Path $path) -and (Select-String -Path $path -Pattern $Marker -SimpleMatch -Quiet)) {
    Remove-Item $path -Force
    Write-Host "  removed $path"
  }
  if (Test-Path "$path.breached-backup") {
    Move-Item "$path.breached-backup" $path -Force
    Write-Host "  restored $path"
  }
}

if (-not $FirefoxDir) { $FirefoxDir = Find-FirefoxDir }
if (-not $ProfilesDir) { $ProfilesDir = Join-Path $env:APPDATA 'Mozilla\Firefox\Profiles' }

if (-not (Test-Writable $FirefoxDir)) {
  if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    Write-Host 'Admin rights are needed to change the Firefox folder. Asking Windows...'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
      '-FirefoxDir', "`"$FirefoxDir`"", '-ProfilesDir', "`"$ProfilesDir`"")
    $p = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $argList -Verb RunAs -Wait -PassThru
    exit $p.ExitCode
  }
  throw "Cannot write to $FirefoxDir."
}

if (Get-Process -Name firefox -ErrorAction SilentlyContinue) {
  throw 'Firefox is running. Close it and run this script again.'
}

Remove-BreachedFile ([IO.Path]::Combine($FirefoxDir, 'distribution', 'policies.json'))
Remove-BreachedFile ([IO.Path]::Combine($FirefoxDir, 'defaults', 'pref', 'autoconfig.js'))
Remove-BreachedFile (Join-Path $FirefoxDir 'breached.cfg')
$xpiDir = [IO.Path]::Combine($FirefoxDir, 'distribution', 'breached')
if (Test-Path $xpiDir) { Remove-Item $xpiDir -Recurse -Force; Write-Host "  removed $xpiDir" }

Get-ChildItem -Path $ProfilesDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-BreachedFile ([IO.Path]::Combine($_.FullName, 'chrome', 'userChrome.css'))
}

Write-Host ''
Write-Host 'Done. uBlock Origin and Tab Sleeper stay installed as normal extensions; remove them in about:addons if you want.'
Write-Host 'Preferences Breached changed go back to Firefox defaults on next start.'
