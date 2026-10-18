/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The PDF viewer's toolbar icons are SVG files under resource://pdf.js/,
// and Gecko draws nothing for them when the page uses them as images
// (masks or backgrounds), though the files themselves load. Icons given
// as data: addresses draw, so this adds a copy of the viewer's styles
// with every SVG inlined.

const SVG_URL = /url\((["']?)([^)"']+\.svg)\1\)/g;

export class PdfIconsParent extends JSWindowActorParent {}

export class PdfIconsChild extends JSWindowActorChild {
  async handleEvent() {
    let doc = this.document;
    let win = this.contentWindow;
    if (doc.nodePrincipal.origin != "resource://pdf.js") {
      return;
    }
    let icons = new Map();
    let icon = async url => {
      if (!icons.has(url)) {
        icons.set(
          url,
          win.fetch(url).then(r => r.text()).then(svg => "data:image/svg+xml," + encodeURIComponent(svg), () => url)
        );
      }
      return icons.get(url);
    };
    for (let link of doc.querySelectorAll("link[rel=stylesheet]")) {
      try {
        let css = await (await win.fetch(link.href)).text();
        let urls = [...new Set([...css.matchAll(SVG_URL)].map(m => m[2]))];
        if (!urls.length) {
          continue;
        }
        let inlined = new Map();
        for (let url of urls) {
          inlined.set(url, await icon(new URL(url, link.href).href));
        }
        css = css.replace(SVG_URL, (_, quote, url) => `url("${inlined.get(url)}")`);
        win.windowUtils.loadSheetUsingURIString("data:text/css," + encodeURIComponent(css), win.windowUtils.AUTHOR_SHEET);
      } catch (e) {
        console.error("Breached: PDF viewer icons", e);
      }
    }
  }
}
