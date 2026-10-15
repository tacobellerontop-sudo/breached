/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// menus / contextMenus. Breached has no right-click menu for extensions yet,
// so this keeps track of the items extensions add (so their calls work and
// their errors match Firefox) without showing them.

var { ExtensionError } = ExtensionUtils;

const menuItemsByExtension = new WeakMap();

this.menusInternal = class extends ExtensionAPIPersistent {
  PERSISTENT_EVENTS = {
    onClicked({ fire }) {
      return {
        unregister() {},
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
      menuItemsByExtension.set(extension, new Map());
    }
    let items = menuItemsByExtension.get(extension);
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
          items.set(createProperties.id, { ...createProperties });
        },
        update: async (id, updateProperties) => {
          let item = items.get(id);
          if (!item) {
            throw new ExtensionError(`Cannot find menu item with id ${id}`);
          }
          Object.assign(item, updateProperties);
        },
        remove: async id => {
          if (!items.delete(id)) {
            throw new ExtensionError(`Cannot find menu item with id ${id}`);
          }
        },
        removeAll: async () => {
          items.clear();
        },
        onClicked: event("onClicked"),
      },
    };
  }
};
