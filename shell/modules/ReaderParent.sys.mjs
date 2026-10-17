/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The window's side of reader view (see ReaderChild.sys.mjs): keeps the
// article found in a page until its about:reader page asks for it.

// url -> article, kept only until the reader page takes it
const articles = new Map();

function keep(url, article) {
  articles.set(url, article);
  // A handful at most: each is a whole page of text.
  while (articles.size > 5) {
    articles.delete(articles.keys().next().value);
  }
}

export class BreachedReaderParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (message.name == "Reader:KeepArticle") {
      keep(message.data.url, message.data);
    }
    return null;
  }
}

export class BreachedReaderViewParent extends JSWindowActorParent {
  receiveMessage(message) {
    switch (message.name) {
      case "Reader:GetCachedArticle": {
        let article = articles.get(message.data.url) ?? null;
        articles.delete(message.data.url);
        // null: the reader page downloads the article itself.
        return article;
      }
      case "RedirectTo":
        keep(message.data.newURL, message.data.article);
        return true;
      case "Reader:FaviconRequest":
        return null;
    }
    return null;
  }
}
