/* Breached shell defaults. The settings from config/breached.cfg are added
   to defaults/preferences/breached.js when the app is packaged. */

pref("toolkit.defaultChromeURI", "chrome://breached/content/shell.xhtml");
pref("toolkit.singletonWindowType", "breached:main");

// Interface (change these on the settings page, or with :set)
pref("breached.tabs.position", "bottom");        // "top", "bottom", "left" or "right" (vertical)
pref("breached.welcome.done", false);           // the first-start page has been shown
pref("breached.tabs.navButtons", true);          // back and forward buttons in the tab bar
pref("breached.tabs.autohide", false);           // true: show only while switching tabs
pref("breached.tabs.showOnHover", true);         // with autohide: show while the mouse is at its edge
pref("breached.tabs.unloadAfterMinutes", 15);    // 0 turns tab unloading off
pref("breached.tabs.maxAwake", 0);               // >0: also unload beyond this many loaded tabs
pref("breached.homepage", "breached:home");      // breached:home, about:blank or any address
pref("breached.newTab", "home");                  // Ctrl+T opens "home" or the "commandbar"
pref("breached.searchUrl", "https://duckduckgo.com/?q=%s");
pref("breached.restoreSession", true);
pref("breached.titlebar", "custom");             // "custom" (Breached's own) or "native" (Windows')

// Colours (#rrggbb): pastel silver and orange by default (Theme.sys.mjs). Presets are on the settings page.
pref("breached.colors.background", "#cfd3da");
pref("breached.colors.text", "#2f3136");
pref("breached.colors.tab", "#bcc1c9");
pref("breached.colors.tabAlt", "#c6cad1");
pref("breached.colors.tabSelected", "#f5b183");
pref("breached.colors.tabSelectedText", "#2f3136");
pref("breached.colors.accent", "#ee9f66");
pref("breached.colors.loading", "#9db8d9");
pref("breached.colors.loaded", "#ee9f66");
pref("breached.colors.error", "#e07b7b");

// See-through bars on Windows 11: "off", "mica" or "acrylic", and how much
// of the bar colour covers the see-through backdrop (percent).
pref("breached.transparency", "off");
pref("breached.transparency.opacity", 60);

// Content windows (window.open, target=_blank) open as tabs.
pref("browser.link.open_newwindow", 3);
pref("browser.link.open_newwindow.restriction", 0);
pref("dom.disable_open_during_load", true);

// Downloads go straight to the Downloads folder, without asking.
pref("browser.download.useDownloadDir", true);
pref("browser.download.folderList", 1);
pref("browser.download.always_ask_before_handling_new_types", false);
pref("browser.download.start_downloads_in_tmp_dir", false);

// Page fullscreen (videos) without the Firefox warning panel.
pref("full-screen-api.enabled", true);
pref("full-screen-api.warning.timeout", 0);

// Built-in tracker and junk blocking (Firefox's "Strict" level). Firefox's
// front end normally turns the "strict" category into these settings.
pref("privacy.trackingprotection.enabled", true);
pref("privacy.trackingprotection.socialtracking.enabled", true);
pref("privacy.trackingprotection.emailtracking.enabled", true);
pref("privacy.trackingprotection.fingerprinting.enabled", true);
pref("privacy.trackingprotection.cryptomining.enabled", true);
pref("network.cookie.cookieBehavior", 5);
pref("privacy.query_stripping.enabled", true);

// Extensions (see extensions/ and chrome/content/addons.js)
pref("extensions.webextensions.remote", true);
pref("xpinstall.signatures.required", true);
pref("extensions.autoDisableScopes", 15);
pref("extensions.startupScanScopes", 0);
pref("extensions.update.enabled", true);
pref("extensions.update.autoUpdateDefault", true);
pref("extensions.getAddons.link.url", "https://addons.mozilla.org/%LOCALE%/firefox/");
pref("extensions.webapi.enabled", true);
pref("extensions.postDownloadThirdPartyPrompt", false);
pref("permissions.manager.defaultsUrl", "resource://app/defaults/permissions");

// Updates from GitHub releases (settings > updates, modules/Updates.sys.mjs)
pref("breached.update.autoCheck", true);
pref("breached.update.lastCheck", 0);

// Site permissions (modules/Permissions.sys.mjs): 0 asks, 2 blocks without asking.
pref("permissions.default.camera", 0);
pref("permissions.default.microphone", 0);
pref("permissions.default.geo", 0);
pref("permissions.default.desktop-notification", 0);
// Location comes from Windows' own location service, not a web service.
pref("geo.provider.ms-windows-location", true);

// Pinned websites on the new tab page (modules/Pins.sys.mjs)
pref("breached.pinnedSites", "[]");

// Emoji from Windows' own font (the app doesn't ship Firefox's Twemoji copy).
pref("font.name-list.emoji", "Segoe UI Emoji");

// Mods (modules/Mods.sys.mjs): the site Breached installs them from, the
// breached-mods repository's GitHub Pages.
pref("breached.mods.site", "https://tacobellerontop-sudo.github.io/breached-mods/");
pref("breached.mods.offerProtectedVideo", true);   // offer the Protected video mod when a site wants DRM
