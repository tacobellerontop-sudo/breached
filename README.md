# Breached

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

Options: `-Lean` for Lean mode (fewer processes, weaker isolation between ordinary sites, see PLAN.md section 6), `-NoUI` to keep Firefox's normal interface. Run the script again after any change, or if a Firefox update removes the files. `scripts\windows\uninstall.ps1` undoes everything and restores any files it replaced.

Tab Sleeper (unloading idle tabs) needs a one-time signing step before Firefox will install it: see [extensions/tab-sleeper/README.md](extensions/tab-sleeper/README.md). Until then, Firefox still unloads tabs when Windows runs low on memory, and "Unload Tab" is in the tab right-click menu.

## What's here

| Path | What it is |
|---|---|
| `config/` | Firefox policies and preferences, commented by goal |
| `ui/userChrome.css` | Minimal UI for the settings pack |
| `extensions/tab-sleeper/` | Idle tab unloader |
| `scripts/windows/` | Install and uninstall |
| `scripts/check-config.py` | Checks every pref and policy still exists in the current Firefox |
