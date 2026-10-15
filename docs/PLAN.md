# Breached: plan for a lightweight, daily-drivable browser

## 1. Summary

Breached is a Windows desktop browser that uses fewer system resources than a stock browser while still opening every modern website.

**Decision: build on Firefox (Gecko), in the style of LibreWolf.** We ship Firefox's engine unchanged, and change only the browser shell: preferences, policies, build flags, a small patch set, and a bundled tab-unloading component. uBlock Origin is bundled and runs at full strength, which is no longer possible in any mainstream Chromium browser.

The five goals map to the plan like this:

| Goal | How Breached does it |
|---|---|
| 1. Unload idle tabs | A bundled "Tab Sleeper" that discards tabs after a period of inactivity, on top of Firefox's built-in low-memory unloading. Tabs restored after restart stay unloaded until clicked. |
| 2. Block page junk | uBlock Origin (full Manifest V2 version) pre-installed and enabled in private windows, plus Firefox's own tracking protection set to Strict. |
| 3. "1 process" | Not possible on any modern engine, and not desirable (section 6). Instead: no idle pre-launched processes, a capped content process count, and an opt-in **Lean mode** that isolates only high-value sites. Tab unloading and ad blocking save far more memory than merging processes would. |
| 4. Remove telemetry and vendor services | Telemetry, studies/experiments, sponsored content, Pocket/Suggest, AI chatbot features, Firefox Accounts/Sync, Safe Browsing and the crash reporter are off or compiled out. Only updates, certificate revocation and the extension blocklist stay. |
| 5. Fewer helpers and background tasks | Compile out the default-browser agent, background update tasks and maintenance service; disable translation, ML, prefetch/speculative connections and other background features by default. |

The first usable version is a **config pack on top of stock Firefox** (no compiling), so LX can daily-drive it almost immediately. Our own branded build follows.

## 2. What "lightweight" means (measurable targets)

We will not claim "lighter" without numbers. Every release is measured on Windows against stock Firefox and Chrome on the same machine with the same tab set (section 9).

- **Memory:** total memory (private working set) with a fixed 20-tab session, measured after 30 minutes idle. Target: clearly below stock Firefox and Chrome, with most of the gain from tab unloading and blocking.
- **Background work:** CPU wakeups per second with the browser idle and minimized. Target: below stock Firefox.
- **Silence:** zero outbound connections at startup and while idle, other than the allow-listed security services (Breached update check, certificate revocation data, extension blocklist). Verified with a capture proxy in CI.
- **Process count:** fewer processes than stock Firefox at idle with the same tab set.
- **Compatibility:** the top-sites smoke test (section 9) passes at the same rate as stock Firefox. Anything we break, we fix or revert.

## 3. Engine choice

### Options considered

| | Gecko fork (LibreWolf-style) | Chromium fork (ungoogled-chromium-style) | Fork of Brave | New engines (Ladybird, Servo) |
|---|---|---|---|---|
| Modern site compatibility | Very good. Firefox is a first-tier target for nearly all sites; a few sites are tested only on Chrome, and Firefox ships site-specific fixes (WebCompat interventions) for many of those. | Best. Chrome is what most developers test on. | Best (Chromium engine). | Not yet daily-drivable. |
| uBlock Origin | **Full uBO (MV2), supported indefinitely by Mozilla**, including blocking `webRequest`, which uBO's best features depend on. | Upstream Chromium has removed Manifest V2. Only uBO Lite (MV3) works without us carrying our own patches to restore MV2, which grow harder with every Chromium release. | Brave keeps a native Rust ad blocker that reads uBO-style filter lists, and has patched MV2 back in for a few extensions. We would inherit that burden. | n/a |
| Telemetry and vendor services | Mostly controllable by prefs and policies, a few build flags. Proven by LibreWolf, Mullvad Browser, Floorp. | Proven by ungoogled-chromium, but requires a large, constantly rebased patch set (Google services are wired deep into Chromium). | Brave adds its own services (rewards, wallet, VPN, news, AI) that we would then have to remove. | n/a |
| Process and memory tuning | Exposed as prefs (process count, isolation strategy, prelaunch). | Mostly hard-coded; site isolation is not tunable without patches. | Same as Chromium. | n/a |
| Maintenance cost | Moderate: a pref overlay plus a small patch set, rebased every 4 weeks. Builds are heavy but scriptable. | High: Chromium releases every 4 weeks with huge diffs; the MV2 patches alone are a running cost. | Very high: two upstreams (Chromium and Brave) to track. | n/a |
| DRM video (Netflix etc.) | Widevine available on Windows. Some services cap resolution in Firefox-based browsers. | Widevine is only available to licensed builds; unofficial Chromium forks often cannot ship it at all. | Brave has a license; a fork does not inherit it. | n/a |

### Decision and reasoning

Gecko wins because it is the only engine where **all five goals are achievable without fighting upstream**:

1. **uBlock Origin is a requirement LX named, and only Gecko runs the real thing long-term.** On Chromium we would either ship uBO Lite (weaker: limited rule counts, no dynamic filtering, no scriptlet flexibility) or carry our own MV2 restoration patches indefinitely as Google deletes the underlying code.
2. **Compatibility is good enough for daily driving.** Firefox is a full, current engine, and the remaining Chrome-only breakages are rare and usually fixed by Firefox's built-in WebCompat interventions or a user-agent override for that site. We keep those interventions enabled (they are not telemetry).
3. **The lightweight levers are configuration, not patches.** Gecko exposes process counts, isolation strategy, tab unloading and every telemetry switch as prefs and enterprise policies. That keeps our patch set small, which is what makes a small project able to keep up with security releases.
4. **There is a proven path.** LibreWolf, Mullvad Browser and others already ship de-telemetried Firefox builds on the same model.

### Honest costs of the Gecko choice

- Some sites still work best in Chrome (a few web apps, some video calling features, some sites that sniff the user agent). Mitigation: keep WebCompat interventions, ship a per-site "pretend to be Chrome" user-agent toggle, and track breakages in an issue label.
- Streaming services may serve lower resolution than in Chrome or Edge on some platforms. This is a DRM licensing limit we cannot fix.
- Firefox builds need a strong machine or CI runners (tens of GB of disk, long builds). We plan for CI builds from day one (section 7).
- We must ship each Firefox security release fast (target: within 72 hours). A browser that lags security updates is not lightweight, it is vulnerable.

### Tracking Release, not ESR

We track **Firefox Release** (every 4 weeks), not ESR. ESR is easier to maintain, but its web platform features are frozen for about a year, which hurts compatibility with modern sites. ESR stays a fallback if the rebase cost ever becomes unmanageable.

## 4. Feature plan

### 4.1 Unload idle tabs ("Tab Sleeper")

Firefox already has the building blocks: it can discard a tab (free its page memory and process) while keeping it in the tab strip, it restores session tabs lazily, and it unloads tabs under memory pressure on Windows. What it lacks is **unloading on a timer**.

Plan:
- Ship Tab Sleeper as a **bundled built-in WebExtension** using the standard `tabs.discard()` API. Using the extension API instead of patching Firefox internals means it survives Firefox updates without rebasing.
- Default rule: a background tab that has not been viewed for **30 minutes** is unloaded. Configurable (5 minutes to never).
- Never unload: the active tab in each window, pinned tabs (configurable), tabs playing audio or video, tabs using camera, microphone or screen sharing, tabs in Picture-in-Picture, and sites on a user allow-list.
- Open item: protecting tabs with unsaved form input. Test whether `tabs.discard()` respects pages that register a "leave page?" prompt; if not, add a small content script that marks tabs with edited forms as "do not unload".
- Prefs: keep `browser.sessionstore.restore_on_demand` on (restored tabs load only when clicked), keep `browser.tabs.unloadOnLowMemory` on (Windows reports low memory to Firefox, so this works out of the box), and enable the "Unload tab" context menu item.
- UI: unloaded tabs show dimmed; an "Unload other tabs" menu item and a toolbar button showing how many tabs are asleep.

### 4.2 Block page junk (uBlock Origin)

- Pre-install uBlock Origin from addons.mozilla.org via the `ExtensionSettings` enterprise policy as a normal install (user can disable or remove it, and it auto-updates from AMO like any extension). We do not fork or repackage uBO.
- Allow it in private windows by default.
- Default filter lists: uBO's defaults (EasyList, EasyPrivacy, uBO filters, Peter Lowe's, URLhaus), plus an optional one-click "annoyances" preset for cookie banners and newsletter pop-ups.
- Firefox Enhanced Tracking Protection set to **Strict** (Total Cookie Protection, tracker and cryptominer blocking). This overlaps with uBO but costs nearly nothing and protects users who disable uBO.
- Blocking is also the biggest single memory and CPU saving on ad-heavy sites, so it counts toward the "lightweight" targets, not just privacy.

### 4.3 Process model

See section 6. In short: no single-process mode; fewer and smaller processes instead.

### 4.4 Remove telemetry and vendor services

Three layers, cheapest first:

**Enterprise policies (`policies.json`)**
`DisableTelemetry`, `DisableFirefoxStudies`, `DisablePocket`, `DisableFirefoxAccounts`, `DisableFeedbackCommands`, `DontCheckDefaultBrowser`, `UserMessaging` (no "what's new", feature tours or extension recommendations), `FirefoxHome` (no sponsored tiles or stories), `FirefoxSuggest` (no sponsored or web suggestions), `OverrideFirstRunPage`.

**Preferences (autoconfig file, locked where it matters)**
- Telemetry and data reporting: `toolkit.telemetry.*`, `datareporting.*`, usage pings, crash report auto-submit.
- Experiments: Normandy and Nimbus studies and rollouts.
- New tab and address bar: sponsored shortcuts, stories, quick suggest, search suggestions off by default.
- AI features: `browser.ml.enable`, `browser.ml.chat.enabled` and related link-preview and smart-tab-group features off.
- Background network chatter: captive portal checks, connectivity checks, link prefetching, DNS prefetching, speculative pre-connections, "discovery" recommendations.
- Safe Browsing: **off entirely** (no list downloads, no lookups to Google). This is the lightest option, and it removes the browser's own phishing and malware warning pages. What still protects the user: uBO's malware-domain list (URLhaus) and Windows Defender/SmartScreen scanning of downloaded files. The settings page notes this so users can choose to re-enable it.

**Build flags and patches**
- Build without the crash reporter, the default-browser agent (a Windows scheduled task), the maintenance service and background update tasks.
- Our builds are unofficial, so Mozilla's telemetry upload endpoints are not configured; we additionally point any remaining endpoint prefs at empty values.
- Remove Mozilla branding (required by Mozilla's trademark policy) and replace it with Breached branding.

**What stays on, deliberately**
- Breached's own update check (an outdated browser is the real risk).
- Remote Settings for security data only: certificate revocation (CRLite) and the extension blocklist. These are pulled, not reporting.
- WebCompat interventions (site fixes; see 3).
- Firefox Accounts/Sync is **removed**: disabled by policy and its UI hidden. Users move bookmarks and passwords with the built-in import/export instead.

### 4.5 Fewer helpers and built-ins

Default off (user can turn on in settings):
- Translations (downloads and runs a local ML model in its own process).
- AI chatbot sidebar, link previews and other ML features.
- Firefox View, Report Broken Site, "Firefox Labs" and the profile backup service.
- Accessibility services stay automatic (they start only when a screen reader or similar tool asks), because disabling them would break assistive technology.
- Form autofill for addresses and cards: off by default; passwords manager stays on.

Kept, because they are cheap or essential: PDF viewer, Reader View, Picture-in-Picture, password manager, WebCompat interventions.

Background throttling: keep Firefox's background-tab timer throttling on, and enable budget-based throttling for background tabs (limits how much CPU a background page's timers can use). Measure the effect before locking it in.

## 5. Settings model

- One settings page section, "Breached", with two toggles at the top: **Tab Sleeper** (and timeout) and **Lean mode** (section 6).
- Everything we change is in one readable autoconfig file in this repo, grouped by goal, with a comment per pref explaining why. Prefs that protect privacy are locked; prefs that trade convenience are defaults the user can change.

## 6. The "1 process" idea, candidly

**Recommendation: do not pursue single-process. Cap processes instead.**

Why single-process is not an option:
- **Neither engine supports it.** Firefox removed single-process (non-e10s) mode from desktop release builds years ago. Chromium's `--single-process` flag is a debugging aid, unsupported and known to crash on real sites. Restoring it would be a large, permanent patch set fighting both upstreams.
- **Security.** Since the Spectre CPU attacks, browsers isolate sites into separate processes because any page can potentially read memory in its own process. With one process, a malicious ad or site can read your bank or email tab's data, and one engine bug compromises everything, including saved passwords. For a daily driver that logs into real accounts this is unacceptable.
- **Stability.** One bad page or GPU driver bug takes down every tab and the browser window.
- **The saving is smaller than it looks.** Most browser memory is page content: scripts, DOM, images, video buffers. That memory exists whether it lives in one process or ten. The per-process overhead is real (tens of MB each) but much smaller than what an ad-heavy page or an idle, still-loaded tab costs. Tab unloading and ad blocking attack the big numbers.

What we do instead:
- **No pre-launched spare process** (`dom.ipc.processPrelaunch.enabled` off): Firefox normally keeps an empty content process ready to speed up new tabs. We trade a few milliseconds per new tab for less idle memory.
- **Cap shared web content processes** (`dom.ipc.processCount`) below Firefox's default, tuned by measurement.
- **Default mode: full site isolation (Fission) on.** Same security as stock Firefox.
- **Lean mode (opt-in):** sets `fission.webContentIsolationStrategy` to isolate only high-value sites (sites you log into), the same strategy Firefox uses on Android to save memory. Other sites share a capped pool of processes. The settings page states the trade-off plainly: less memory, weaker isolation between ordinary sites. Lean mode must be validated (memory saving measured, no site breakage) before it ships.
- Support processes (GPU, network socket, media decoding, utility) stay. They exist for sandboxing and crash containment, and are small.
- Unloaded tabs release their processes entirely, which is where the process count actually drops.

## 7. Build and repository structure

Approach: **patch-and-overlay on Firefox source tarballs**, not a git fork of mozilla-central. We keep only our changes in this repo; a script downloads the matching Firefox source, applies patches and config, and builds. Rebasing to a new Firefox version means updating a version number and fixing any patches that no longer apply.

Planned layout:

```
docs/              plan, decisions, benchmark results
config/
  policies.json    enterprise policies (section 4.4)
  breached.cfg     autoconfig prefs, grouped by goal, commented
  lean.cfg         Lean mode overrides
extensions/
  tab-sleeper/     built-in tab unloading extension
patches/           small, numbered patches against Firefox source
branding/          Breached name, icons (replaces Mozilla trademarks)
mozconfigs/        build flags per platform
scripts/           fetch-source, apply-patches, build, package
bench/             memory, wakeup, network-silence and compat harness
.github/workflows/ CI: build, test, measure, release
```

Platform: **Windows x86_64 only** (decided). Windows ARM64 can be added later with the same scripts.

Build: Mozilla itself builds Windows Firefox by cross-compiling from Linux with clang, so our CI can do the same on Linux runners (cheaper and faster than Windows runners). Firefox builds exceed the standard free CI runner limits, so we either use larger hosted runners, a self-hosted build machine, or compiler caching (sccache). Decide at milestone M1.

Install and updates:
- **Per-user install** into `%LOCALAPPDATA%` by default, so installing and updating never needs an admin (UAC) prompt and we need no background update service.
- A small built-in update check on startup (no scheduled task, no Windows service) that compares against our GitHub releases and offers the new installer.
- Code-sign the installer and executables, otherwise SmartScreen warns on every download. A signing certificate is a recurring cost; until we have one, early builds will show the "unknown publisher" warning.

## 8. Milestones

**M0: Config pack (daily drivable on stock Firefox)**
- `policies.json` + autoconfig prefs + uBO install, applied to an installed stock Firefox on Windows with one PowerShell script.
- Tab Sleeper extension v1, loaded as a normal extension.
- Benchmark harness baseline: stock Firefox vs. Firefox + config pack vs. Chrome.
- Exit: LX uses it as the main browser for a week; regressions logged.

**M1: Tune**
- Measure and tune process caps, prelaunch, throttling; prototype Lean mode and decide whether it ships.
- Network-silence test in CI (capture proxy, allow-list).
- Compat smoke test on top sites.

**M2: Own Windows build**
- Scripts to fetch Firefox source, apply patches, cross-compile for Windows with our mozconfig (no crash reporter, no default-browser agent, no maintenance service).
- Breached branding; Tab Sleeper bundled as a built-in.
- CI build and nightly artifacts.

**M3: Installer and updates**
- Per-user installer, startup update check, code signing.
- First public release.

**M4: Release automation**
- Bot that watches Firefox releases, bumps the version, rebuilds, runs the test suite and opens a release PR.
- Security release target: Breached update out within 72 hours of a Firefox security release.

## 9. Testing and measurement

- **Memory/CPU benchmark:** scripted (Playwright/Marionette) session of 20 fixed tabs (news sites, YouTube, a webmail, a docs editor, a social feed, shopping), then idle. Record total memory, process count and idle wakeups at 5 and 30 minutes. Same script against stock Firefox and Chrome. Results committed to `docs/benchmarks/` per release.
- **Network silence:** launch with a fresh profile behind a capture proxy, idle 10 minutes, fail CI on any host outside the allow-list.
- **Compatibility:** load the top ~200 sites, check for page errors and visual breakage against stock Firefox of the same version; plus a manual checklist of daily-driver flows (video call, streaming video, banking login, Google Docs, Office web).
- **Tab Sleeper:** automated tests for every "never unload" rule.

## 10. Risks and open questions

| Risk | Mitigation |
|---|---|
| Falling behind Firefox security releases | Release automation (M4), small patch set, ESR as an emergency fallback. |
| A pref we disable breaks a site | Compat test per release; every disabled feature is a commented pref, easy to revert. |
| Lean mode weakens security more than expected | Opt-in only, clearly labelled, and dropped if measurements show little memory saving. |
| Build infrastructure cost | Decide hosted vs. self-hosted runners at M2; the config pack (M0) needs no build infrastructure at all. |
| Trademark | Remove all Firefox branding before any public build. |
| No Safe Browsing warnings | uBO malware-domain list plus Windows Defender/SmartScreen; users can re-enable Safe Browsing in settings. |

Decided by LX (2026-10-15):
1. Platform: Windows only.
2. Sync: removed entirely (lightest option).
3. Safe Browsing: off entirely (lightest option); see 4.4 for what still protects users.
