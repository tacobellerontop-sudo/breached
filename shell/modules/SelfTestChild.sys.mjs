/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Only for the self-test (selftest.js registers it): makes mouse events
// inside a page, in the page's own process, like a real mouse would.

export class BreachedSelfTestChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name == "SelfTest:Reader") {
      let content = this.document.querySelector(".moz-reader-content");
      return { url: this.document.documentURI, chars: content?.textContent.length ?? 0, title: this.document.title };
    }
    if (message.name == "SelfTest:Element") {
      let el = this.document.querySelector(message.data.selector);
      let root = { ...this.document.documentElement.dataset };
      if (!el) {
        return { root };
      }
      let r = el.getBoundingClientRect();
      let attrs = {};
      for (let a of el.attributes) {
        attrs[a.name] = a.value;
      }
      return { text: el.textContent.trim(), attrs, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, root };
    }
    if (message.name == "SelfTest:Style") {
      let el = this.document.querySelector(message.data.selector);
      if (!el) {
        return null;
      }
      let style = this.contentWindow.getComputedStyle(el, message.data.pseudo ?? null);
      return Object.fromEntries(message.data.props.map(p => [p, style.getPropertyValue(p)]));
    }
    if (message.name == "SelfTest:Page") {
      let doc = this.document;
      return {
        url: doc.documentURI,
        scrollY: this.contentWindow.scrollY,
        hints: Number(doc.querySelector("[data-breached-hints]")?.getAttribute("data-breached-hints") ?? 0),
        dark: doc.documentElement.hasAttribute("data-breached-dark"),
        active: doc.activeElement?.id ?? "",
      };
    }
    if (message.name == "SelfTest:Extras") {
      // Elements an extension added to the page (outside the page's own markup).
      let doc = this.document;
      let names = new Set();
      for (let el of doc.querySelectorAll("*")) {
        if (el.localName.includes("-") || /bitwarden|bwi|autofill/i.test(el.className?.toString?.() ?? "")) {
          names.add(el.localName + (el.id ? "#" + el.id : ""));
        }
      }
      return {
        custom: [...names].slice(0, 30),
        bodyAttrs: [...doc.body.attributes].map(a => a.name),
        credentialsOwn: Object.getOwnPropertyNames(Cu.waiveXrays(this.contentWindow).navigator.credentials),
      };
    }
    if (message.name == "SelfTest:Credentials") {
      // Whether the page's navigator.credentials is Bitwarden's (wrapped) or Gecko's own.
      let creds = Cu.waiveXrays(this.contentWindow).navigator.credentials;
      return { own: Object.getOwnPropertyNames(creds), get: String(creds.get).slice(0, 60) };
    }
    if (message.name == "SelfTest:Inputs") {
      // Every input of the page, as a password manager sees it.
      return [...this.document.querySelectorAll("input")].map(i => {
        let r = i.getBoundingClientRect();
        return {
          type: i.type,
          name: i.name,
          id: i.id,
          autocomplete: i.getAttribute("autocomplete"),
          value: i.type == "password" ? i.value.length : i.value,
          tabIndex: i.tabIndex,
          ariaHidden: i.getAttribute("aria-hidden"),
          rect: [Math.round(r.width), Math.round(r.height)],
          visible: i.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          focused: this.document.activeElement === i,
        };
      });
    }
    if (message.name == "SelfTest:Login") {
      // Types a login into the page's form and sends it, like a person would.
      let { username, password } = message.data;
      let user = this.document.querySelector("form input[type=text], form input[type=email]");
      let pass = this.document.querySelector("form input[type=password]");
      user?.setUserInput(username);
      pass?.setUserInput(password);
      pass?.form?.requestSubmit();
      return !!(user && pass);
    }
    if (message.name != "SelfTest:Mouse") {
      return null;
    }
    let { type, x, y, button } = message.data;
    let win = this.contentWindow;
    let buttons = type == "mousedown" ? 1 << (button == 2 ? 1 : 0) : 0;
    if (typeof win.synthesizeMouseEvent == "function") {
      win.synthesizeMouseEvent(type, x, y, { button, buttons, clickCount: 1 });
      return "synthesizeMouseEvent";
    }
    win.windowUtils.sendMouseEvent(type, x, y, button, 1, 0);
    return "sendMouseEvent";
  }
}
