/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// menus / contextMenus: the items extensions add to the page's right-click
// menu (uBlock Origin's "Block element", for one). Breached's menu (see
// contextmenu.js) fires Breached:ContextMenu on the window while it fills
// itself in; each extension's items that fit what was clicked are added
// then, one item on its own or several under the extension's name.

var { ExtensionError } = ExtensionUtils;

// extension -> Map(id -> item), in the order they were made
const menuItemsByExtension = new Map();

/** The contexts ("link", "image", ...) a click matches, from the page's data. */
function contextsOf(data) {
  let contexts = new Set(["all"]);
  if (data.link) {
    contexts.add("link");
  }
  if (data.mediaType) {
    contexts.add(data.mediaType);
  }
  if (data.selection) {
    contexts.add("selection");
  }
  if (data.editable) {
    contexts.add("editable");
    if (data.password) {
      contexts.add("password");
    }
  }
  if (data.frameURL) {
    contexts.add("frame");
  }
  if (contexts.size == 1 || (contexts.size == 2 && data.frameURL)) {
    contexts.add("page");
  }
  return contexts;
}

function matches(patterns, url) {
  if (!patterns || !url) {
    return !patterns;
  }
  try {
    return new MatchPatternSet(patterns, { restrictSchemes: false }).matches(Services.io.newURI(url));
  } catch (e) {
    return false;
  }
}

function fits(item, data, contexts) {
  if (item.visible === false) {
    return false;
  }
  let wanted = item.contexts ?? ["page"];
  if (!wanted.some(c => contexts.has(c))) {
    return false;
  }
  if (item.documentUrlPatterns && !matches(item.documentUrlPatterns, data.frameURL || data.pageURL)) {
    return false;
  }
  if (item.targetUrlPatterns) {
    let target = data.link || data.mediaURL;
    if (!target || !matches(item.targetUrlPatterns, target)) {
      return false;
    }
  }
  return true;
}

/** What onClicked's info says about the click. */
function clickInfo(item, data, checked) {
  let info = {
    menuItemId: item.id,
    editable: !!data.editable,
    pageUrl: data.pageURL,
    frameId: data.frameId ?? 0,
    modifiers: [],
    button: 0,
  };
  if (item.parentId != null) {
    info.parentMenuItemId = item.parentId;
  }
  if (data.frameURL) {
    info.frameUrl = data.frameURL;
  }
  if (data.link) {
    info.linkUrl = data.link;
    info.linkText = data.linkText ?? "";
  }
  if (data.mediaType) {
    info.mediaType = data.mediaType;
    info.srcUrl = data.mediaURL;
  }
  if (data.selection) {
    info.selectionText = data.selection;
  }
  if (item.type == "checkbox" || item.type == "radio") {
    info.wasChecked = !!item.checked;
    info.checked = checked;
  }
  return info;
}

/** Adds one extension's fitting items to the menu being shown. */
function addItems(extension, items, menu) {
  let { data, nativeTab } = menu;
  let contexts = contextsOf(data);
  let fitting = [...items.values()].filter(item => fits(item, data, contexts));
  // A child shows only under a parent that shows.
  let childrenOf = parentId => fitting.filter(i => (i.parentId ?? null) === parentId);

  let entry = item => {
    if (item.type == "separator") {
      return { separator: true };
    }
    let title = String(item.title ?? "").replace(/%s/g, (data.selection ?? "").slice(0, 60));
    let children = childrenOf(item.id);
    let result = {
      label: title,
      disabled: item.enabled === false,
      icon: item.icons ? Object.values(item.icons)[0] : null,
    };
    if (children.length) {
      result.items = children.map(entry);
      return result;
    }
    if (item.type == "checkbox" || item.type == "radio") {
      result.checkbox = true;
      result.checked = !!item.checked;
    }
    result.run = () => {
      let checked = item.type == "checkbox" ? !item.checked : item.type == "radio" ? true : undefined;
      if (item.type == "checkbox") {
        item.checked = checked;
      } else if (item.type == "radio") {
        for (let other of items.values()) {
          if (other.type == "radio" && other.parentId === item.parentId) {
            other.checked = other === item;
          }
        }
      }
      if (nativeTab) {
        extension.tabManager.addActiveTabPermission(nativeTab);
      }
      let tab = nativeTab && extension.tabManager.canAccessTab(nativeTab) ? extension.tabManager.convert(nativeTab) : undefined;
      extension.emit("webext-menu-menuitem-click", clickInfo(item, data, checked), tab);
    };
    return result;
  };

  let top = childrenOf(null).map(entry);
  // Drop separators at the ends.
  while (top.length && top[0].separator) {
    top.shift();
  }
  while (top.length && top[top.length - 1].separator) {
    top.pop();
  }
  if (!top.length) {
    return;
  }
  if (top.length == 1) {
    menu.add(top);
  } else {
    let icon = extension.manifest.icons ? Object.values(extension.manifest.icons)[0] : null;
    menu.add([{ label: extension.name, icon: icon && extension.baseURI.resolve(icon), items: top }]);
  }
}

const contextMenuListener = {
  handleEvent(event) {
    let menu = event.detail;
    for (let [extension, items] of menuItemsByExtension) {
      if (!items.size || (menu.isPrivate && !extension.privateBrowsingAllowed)) {
        continue;
      }
      try {
        addItems(extension, items, menu);
      } catch (e) {
        console.error(e);
      }
    }
  },
};

this.menusInternal = class extends ExtensionAPIPersistent {
  onStartup() {
    if (!menuItemsByExtension.size) {
      windowTracker.addListener("Breached:ContextMenu", contextMenuListener);
    }
    menuItemsByExtension.set(this.extension, new Map());
  }

  onShutdown() {
    menuItemsByExtension.delete(this.extension);
    if (!menuItemsByExtension.size) {
      windowTracker.removeListener("Breached:ContextMenu", contextMenuListener);
    }
  }

  PERSISTENT_EVENTS = {
    onClicked({ fire }) {
      let { extension } = this;
      let listener = (event, info, tab) => {
        fire.sync(info, tab);
      };
      extension.on("webext-menu-menuitem-click", listener);
      return {
        unregister() {
          extension.off("webext-menu-menuitem-click", listener);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    },
    onShown({ fire }) {
      return {
        unregister() {},
        convert(_fire) {
          fire = _fire;
        },
      };
    },
    onHidden({ fire }) {
      return {
        unregister() {},
        convert(_fire) {
          fire = _fire;
        },
      };
    },
  };

  getAPI(context) {
    let { extension } = context;
    if (!menuItemsByExtension.has(extension)) {
      this.onStartup();
    }
    let items = () => menuItemsByExtension.get(extension) ?? new Map();
    let event = name =>
      new EventManager({
        context,
        module: "menusInternal",
        event: name,
        name: `menus.${name}`,
        extensionApi: this,
      }).api();

    const menus = {
      refresh() {},
      onShown: event("onShown"),
      onHidden: event("onHidden"),
    };

    return {
      contextMenus: menus,
      menus,
      menusInternal: {
        create: async createProperties => {
          let all = items();
          if (createProperties.parentId != null && !all.has(createProperties.parentId)) {
            throw new ExtensionError(`Could not find any MenuItem with id: ${createProperties.parentId}`);
          }
          if (createProperties.type == "radio" && createProperties.checked == null) {
            createProperties.checked = false;
          }
          all.set(createProperties.id, { type: "normal", ...createProperties });
        },
        update: async (id, updateProperties) => {
          let item = items().get(id);
          if (!item) {
            throw new ExtensionError(`Cannot find menu item with id ${id}`);
          }
          for (let [key, value] of Object.entries(updateProperties)) {
            if (value !== null) {
              item[key] = value;
            }
          }
        },
        remove: async id => {
          let all = items();
          if (!all.delete(id)) {
            throw new ExtensionError(`Cannot find menu item with id ${id}`);
          }
          // Its submenu goes with it.
          let gone = [id];
          while (gone.length) {
            let parent = gone.pop();
            for (let [childId, child] of all) {
              if (child.parentId === parent) {
                all.delete(childId);
                gone.push(childId);
              }
            }
          }
        },
        removeAll: async () => {
          items().clear();
        },
        onClicked: event("onClicked"),
      },
    };
  }
};
