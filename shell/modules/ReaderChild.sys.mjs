/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reader view (":reader"): Gecko's own about:reader page and its article
// finder (Readability), which Firefox drives from its front end; these
// actors do that part for Breached.
//
// - BreachedReaderChild, made on demand in any page: finds the article,
//   hands it to the window to keep, and opens about:reader?url=...
// - BreachedReaderViewChild, in about:reader pages only: asks the window for
//   that article and sets up Gecko's reader page (AboutReader) with it.

function load(name) {
  for (let url of [`moz-src:///toolkit/components/reader/${name}.sys.mjs`, `resource://gre/modules/${name}.sys.mjs`]) {
    try {
      return ChromeUtils.importESModule(url)[name];
    } catch (e) {
      // try the older place
    }
  }
  throw new Error(`no ${name} in this Gecko`);
}

function isReaderPage(document) {
  return document?.documentURI.startsWith("about:reader") ?? false;
}

export class BreachedReaderChild extends JSWindowActorChild {
  async receiveMessage(message) {
    if (message.name != "Reader:Toggle") {
      return null;
    }
    if (isReaderPage(this.document)) {
      load("ReaderMode").leaveReaderMode(this.docShell, this.contentWindow);
      return "left";
    }
    let article = await load("ReaderMode").parseDocument(this.document);
    if (!article) {
      return "no-article";
    }
    await this.sendQuery("Reader:KeepArticle", article);
    load("ReaderMode").enterReaderMode(this.docShell, this.contentWindow);
    return "entered";
  }
}

export class BreachedReaderViewChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type != "DOMContentLoaded" || event.originalTarget != this.document || !isReaderPage(this.document)) {
      return;
    }
    if (!this.document.body) {
      return;
    }
    let url = decodeURIComponent(this.document.documentURI.slice("about:reader?url=".length));
    let article = this.sendQuery("Reader:GetCachedArticle", { url });
    let AboutReader = load("AboutReader");
    this._reader = new AboutReader(this, article, "document");
  }

  receiveMessage(message) {
    this._reader?.receiveMessage(message);
  }

  didDestroy() {
    this.readerModeHidden();
  }

  // AboutReader calls these.
  readerModeHidden() {
    this._reader?.clearActor();
    this._reader = null;
  }

  closeReaderMode() {
    if (isReaderPage(this.document)) {
      load("ReaderMode").leaveReaderMode(this.docShell, this.contentWindow);
    }
  }
}
