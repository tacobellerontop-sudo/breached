# Runs Breached's built-in self-test (shell/chrome/content/selftest.js) on a
# packaged app, headless, with the test helpers it needs. Screenshots and
# report.json go to -Shots. Throws if the test fails.
#
#   pwsh scripts/test/run-selftest.ps1 -App out\breached -Shots screenshots
#
# -NoAppArg starts breached.exe without "-app application.ini", to check that
# our own Gecko build finds the shell by itself.

param(
    [Parameter(Mandatory)] [string] $App,
    [Parameter(Mandatory)] [string] $Shots,
    [switch] $NoAppArg,
    [string] $Exe = 'breached.exe'
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\..\.."
$appDir = (Resolve-Path $App).Path
# (PowerShell names ignore case: these must differ from -App and -Shots.)
$shotDir = (New-Item -ItemType Directory -Force $Shots).FullName
$env:BREACHED_SELFTEST = $shotDir

# Test helpers: a stand-in bw.exe and a local login page.
$tools = New-Item -ItemType Directory -Force "$env:RUNNER_TEMP\breached-test"
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /out:"$tools\bw.exe" (Join-Path $repo 'scripts\test\FakeBw.cs')
$env:BREACHED_TEST_BW = "$tools\bw.exe"
$server = Start-Process python -PassThru -NoNewWindow -ArgumentList '-m', 'http.server', '8123', '--bind', '127.0.0.1', '--directory', (Join-Path $repo 'scripts\test')
$env:BREACHED_TEST_LOGIN_PAGE = 'http://127.0.0.1:8123/login.html'

# A throwaway profile; let the test's progress lines through to the log.
$testProfile = Join-Path $env:RUNNER_TEMP "breached-selftest-profile-$(Get-Random)"
New-Item -ItemType Directory $testProfile | Out-Null
Set-Content "$testProfile\user.js" 'user_pref("browser.dom.window.dump.enabled", true);'

$argList = @()
if (-not $NoAppArg) { $argList += '-app', "$appDir\breached\application.ini" }
$argList += '-profile', $testProfile, '-no-remote', '-headless', '-wait-for-browser', '-attach-console'
$out = Join-Path $shotDir 'selftest-out.txt'
$err = Join-Path $shotDir 'selftest-err.txt'
"Starting $Exe $($argList -join ' ')"
$p = Start-Process "$appDir\$Exe" -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err -ArgumentList $argList
if (-not $p.WaitForExit(360000)) {
    "Self-test did not finish. Running processes:"
    Get-Process | Where-Object { $_.Path -like "$appDir*" } | Format-Table Id, Name, StartTime -AutoSize | Out-String
    $p.Kill($true)
    "--- stdout"; Get-Content $out -Tail 60 -ErrorAction SilentlyContinue
    "--- stderr"; Get-Content $err -Tail 60 -ErrorAction SilentlyContinue
} else {
    Get-Content $out, $err -ErrorAction SilentlyContinue | Select-String 'SELFTEST|Breached|error' | Select-Object -First 200
}
Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $testProfile -ErrorAction SilentlyContinue

$report = Join-Path $shotDir 'report.json'
if (-not (Test-Path $report)) { throw 'no report.json' }
Get-Content $report
if (-not (Get-Content $report | ConvertFrom-Json).passed) { throw 'self-test failed' }
