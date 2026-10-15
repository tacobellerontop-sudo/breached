/* Gives Breached's own pages the browser's colours, and keeps them in step
 * when the colours change. */

"use strict";

{
  const Theme = ChromeUtils.importESModule("resource://breached/Theme.sys.mjs");
  Theme.applyColors(document.documentElement);
  const stop = Theme.watchColors(() => Theme.applyColors(document.documentElement));
  window.addEventListener("unload", stop, { once: true });
}
