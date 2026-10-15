# Tab Sleeper

Unloads ("discards") background tabs you haven't viewed for a while, so their memory is freed. The tab stays in the tab strip and reloads when you click it. Part of Breached (docs/PLAN.md, section 4.1).

**Never unloads:** the tab you're looking at in each window, pinned tabs (configurable), tabs playing audio, tabs using your camera, microphone or screen, tabs where you've typed something you haven't submitted, sites on your never-sleep list, and non-web pages (about:, settings).

**Settings:** timeout (default 30 minutes), pinned-tab protection and the never-sleep list, in the extension's options. The toolbar button shows how many tabs are asleep and has "Sleep other tabs now" and "Never sleep this site".

## Getting it into Firefox

Release Firefox only installs extensions signed by Mozilla, so Tab Sleeper needs a one-time signing step (free, and it stays private: "unlisted" add-ons are not published on addons.mozilla.org).

1. Create API keys at https://addons.mozilla.org/developers/addon/api/key/ (needs a Firefox account, used only for this).
2. Add them to this GitHub repository as secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.
3. Run the **Sign Tab Sleeper** workflow in the Actions tab, download `tab-sleeper.xpi` and save it as `dist\tab-sleeper.xpi`.
4. Run `scripts\windows\install.ps1`; it installs Tab Sleeper automatically when that file exists.

To try it unsigned: open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on" and pick `manifest.json`. It stays until Firefox restarts.

Once Breached has its own build (milestone M2), Tab Sleeper ships built in and this step goes away.

## Development

```
node --test test/rules.test.js       # rule tests
npx web-ext lint --ignore-files "test/**"
npx web-ext run                      # opens a test Firefox with it loaded
```

`rules.js` holds all the "may this tab sleep?" logic as a pure function so it can be tested without a browser.
