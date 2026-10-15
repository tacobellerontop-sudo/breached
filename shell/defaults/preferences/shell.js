/* Breached shell defaults. The settings from config/breached.cfg are added
   to defaults/preferences/breached.js when the app is packaged. */

pref("toolkit.defaultChromeURI", "chrome://breached/content/shell.xhtml");
pref("toolkit.singletonWindowType", "breached:main");

// Interface (change with :set, e.g. ":set tabs.position top")
pref("breached.tabs.position", "bottom");        // "top" or "bottom"
pref("breached.tabs.autohide", false);           // true: show only while switching tabs
pref("breached.tabs.unloadAfterMinutes", 15);    // 0 turns tab unloading off
pref("breached.tabs.maxAwake", 0);               // >0: also unload beyond this many loaded tabs
pref("breached.homepage", "about:blank");
pref("breached.searchUrl", "https://duckduckgo.com/?q=%s");
pref("breached.restoreSession", true);

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
