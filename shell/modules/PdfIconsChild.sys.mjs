/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The PDF viewer's toolbar icons are SVG files under resource://pdf.js/,
// and Gecko draws nothing for them when the page uses them as images
// (masks or backgrounds), though the files themselves load. Icons given
// as data: addresses draw, so this puts every SVG in the viewer's styles
// inline.

const SVG_URL = /url\((["']?)([^)"']+\.svg)\1\)/g;

export class BreachedPdfIconsChild extends JSWindowActorChild {
  async handleEvent() {
    let doc = this.document;
    let win = this.contentWindow;
    if (doc.nodePrincipal.origin != "resource://pdf.js") {
      return;
    }
    let icons = new Map();
    let icon = url => {
      if (!icons.has(url)) {
        icons.set(
          url,
          win.fetch(url).then(r => r.text()).then(svg => "data:image/svg+xml," + encodeURIComponent(svg), () => url)
        );
      }
      return icons.get(url);
    };
    let inline = async (rules, base) => {
      for (let rule of rules) {
        if (rule.cssRules) {
          await inline(rule.cssRules, base);
        }
        let style = rule.style;
        for (let i = 0; style && i < style.length; i++) {
          let prop = style[i];
          let value = style.getPropertyValue(prop);
          let found = [...value.matchAll(SVG_URL)];
          if (!found.length) {
            continue;
          }
          for (let [whole, , url] of found) {
            value = value.replace(whole, `url("${await icon(new URL(url, base).href)}")`);
          }
          style.setProperty(prop, value, style.getPropertyPriority(prop));
        }
      }
    };
    for (let link of doc.querySelectorAll("link[rel=stylesheet]")) {
      try {
        if (!link.sheet) {
          await new Promise(resolve => link.addEventListener("load", resolve, { once: true }));
        }
        await inline(link.sheet.cssRules, link.sheet.href);
      } catch (e) {
        console.error("Breached: PDF viewer icons", e);
      }
    }
  }
}
