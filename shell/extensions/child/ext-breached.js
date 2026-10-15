/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Extension-page side of Breached's WebExtension APIs.

extensions.registerModules({
  // Because of permissions, the module name must differ from both namespaces.
  menusInternal: {
    url: "chrome://breachedext/content/child/ext-menus.js",
    scopes: ["addon_child"],
    paths: [["contextMenus"], ["menus"]],
  },
  tabs: {
    url: "chrome://breachedext/content/child/ext-tabs.js",
    scopes: ["addon_child"],
    paths: [["tabs"]],
  },
});
