# Breached

Website: https://tacobellerontop-sudo.github.io/breached/ (source in `site/`, published by `.github/workflows/pages.yml`).

A lightweight, daily-drivable Windows web browser built on Firefox's engine: a small custom interface, fewer background tasks, no telemetry or vendor services, idle tabs unloaded, and full uBlock Origin.

See [docs/PLAN.md](docs/PLAN.md) for the engine choice, feature plan and milestones.

## Try it now (M0 settings pack)

The first milestone turns a normal Firefox install into Breached's setup without compiling anything.

1. Install [Firefox](https://www.mozilla.org/firefox/) for Windows, start it once, then close it.
2. Download this repository (Code > Download ZIP) and unzip it.
3. In the unzipped folder, open PowerShell and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1
   ```

   Windows will ask for admin rights, because the files go into Firefox's install folder.
4. Start Firefox. `about:policies` lists what Breached changed, and uBlock Origin installs itself on first start.

It also installs Vimium for qutebrowser-style keys (`o` to open, `f` for link hints, `J`/`K` to switch tabs). The address bar hides until you press Ctrl+L or hover the tab bar.

Options: `-Lean` for Lean mode (fewer processes, weaker isolation between ordinary sites, see PLAN.md section 6), `-NoUI` to keep Firefox's normal interface. Run the script again after any change, or if a Firefox update removes the files. `scripts\windows\uninstall.ps1` undoes everything and restores any files it replaced.

Tab Sleeper (unloading idle tabs) needs a one-time signing step before Firefox will install it: see [extensions/tab-sleeper/README.md](extensions/tab-sleeper/README.md). Until then, Firefox still unloads tabs when Windows runs low on memory, and "Unload Tab" is in the tab right-click menu.

## Install Breached

Download **BreachedSetup-<version>.exe** from the [latest release](https://github.com/tacobellerontop-sudo/breached/releases/latest) and run it. It installs for your Windows account without admin rights (or for everyone, if you pick that), adds Breached to the Start menu, and keeps your profile in `%APPDATA%\Breached`. The portable zip on the same page needs no install: unzip it and run `Breached.bat`.

To update, open settings > Updates (or type `:update`). An installed copy downloads the new installer from GitHub, runs it and starts again; a portable copy opens the release page. Breached also checks once a day and says so in the message bar; turn that off on the same page. Version numbers live in `BREACHED_VERSION` in `shell/chrome/content/shell.js`, which the Release workflow checks against the version you enter, and `docs/releases/<version>.md` holds each release's notes.

The files aren't code-signed yet, so SmartScreen may warn the first time: choose More info, then Run anyway.

Releases run on Breached's own build of the Gecko engine (`.github/workflows/build-gecko.yml`, with the changes in `gecko/patches/`), so `breached.exe` is the engine itself and carries the Breached icon (`branding/`, drawn by `scripts/build/make-icon.py`). The **Release** workflow packages it, runs the self-test, builds the installer (`installer/breached.iss`) and publishes the release.

## The Breached app (dev builds)

Every change to `app/` builds a portable Windows zip on GitHub: open the latest **Build Breached (dev)** run in the Actions tab, download `breached-dev-win64`, unzip it and run `Breached.bat`. It keeps its own profile in the `profile` folder next to it, so it doesn't touch an installed Firefox.

Press `:` for the command line (`:open`, `:tabopen`, `:tab-close`, `:tab-focus 2`, `:undo`, `:set`, `:help`). Tab completes command names; Up/Down recalls history.

## What's here

| Path | What it is |
|---|---|
| `config/` | Firefox policies and preferences, commented by goal |
| `ui/userChrome.css` | qutebrowser-style minimal UI for the settings pack |
| `extensions/tab-sleeper/` | Idle tab unloader |
| `scripts/windows/` | Install and uninstall |
| `scripts/check-config.py` | Checks every pref and policy still exists in the current Firefox |
| `app/` | The Breached app: interface, actors, branding settings, build config |
| `scripts/build/` | Turns Firefox source into Breached, and the smoke test |

## Code signing and privacy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org). See the [code signing policy](https://tacobellerontop-sudo.github.io/breached/code-signing.html) and the [privacy policy](https://tacobellerontop-sudo.github.io/breached/privacy.html): Breached collects no data.

## Licence

Mozilla Public License 2.0, see [LICENSE](LICENSE). Firefox's engine, which Breached runs on, is Mozilla's and under the same licence.
