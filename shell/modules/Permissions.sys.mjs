/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sites asking for the camera, microphone, screen, location, notifications
// and the like. Firefox's front end normally answers these; Breached asks in
// its command bar instead (Breached.askPermission in shell.js) and keeps
// "always" and "never" answers in Gecko's permission manager, where the web's
// Permissions API and settings > privacy read them.
//
// Two kinds of request reach this module:
// - camera, microphone, screen and speakers come from PermissionsChild.sys.mjs
//   (getUserMedia has its own path through Gecko);
// - everything else comes through nsIContentPermissionPrompt, which this
//   module provides.

const ALLOW = Ci.nsIPermissionManager.ALLOW_ACTION;
const DENY = Ci.nsIPermissionManager.DENY_ACTION;

/**
 * What each permission is called, how a site asks for it ("example.com
 * wants to ..."), and whether an answer can be remembered. The key is the
 * name Gecko's permission manager uses.
 */
export const KINDS = {
  camera: { name: "Camera", asks: "use your camera" },
  microphone: { name: "Microphone", asks: "use your microphone" },
  screen: { name: "Screen sharing", asks: "share your screen", once: true },
  "audio-capture": { name: "Computer sound", asks: "record your computer's sound", once: true },
  speaker: { name: "Speakers", asks: "choose your speakers", once: true },
  geo: { name: "Location", asks: "know your location" },
  "desktop-notification": { name: "Notifications", asks: "show notifications" },
  "persistent-storage": { name: "Stored data", asks: "keep its data on this computer" },
  midi: { name: "MIDI", asks: "use your MIDI devices" },
  "midi-sysex": { name: "MIDI (full access)", asks: "use your MIDI devices, with full access" },
  xr: { name: "Virtual reality", asks: "use your VR headset" },
  "local-network": { name: "Local network", asks: "connect to devices on your network" },
  "loopback-network": { name: "This computer's network", asks: "connect to apps on this computer" },
  "storage-access": { name: "Cookies on other sites", asks: "use its cookies on this site", once: true },
};

// Gecko's request type names that differ from the permission's.
const REQUEST_TYPES = { geolocation: "geo" };

/** Permissions this module can remember, for settings > privacy. */
export const REMEMBERED = Object.keys(KINDS).filter(k => !KINDS[k].once);

function kindFor(type) {
  return REQUEST_TYPES[type] ?? type;
}

function hostOf(principal) {
  try {
    return principal.URI.displayHostPort || principal.origin;
  } catch (e) {
    return principal.origin;
  }
}

/** "allow", "deny" or null (ask) for a site, from saved answers and settings. */
function saved(principal, kinds) {
  let answers = kinds.map(kind => {
    if (Services.prefs.getIntPref("permissions.default." + kind, 0) == 2) {
      return "deny";
    }
    let action = Services.perms.testExactPermissionFromPrincipal(principal, kind);
    return action == ALLOW ? "allow" : action == DENY ? "deny" : null;
  });
  if (answers.includes("deny")) {
    return "deny";
  }
  return answers.every(a => a == "allow") ? "allow" : null;
}

function remember(principal, kinds, allow) {
  for (let kind of kinds) {
    if (!KINDS[kind]?.once) {
      Services.perms.addFromPrincipal(principal, kind, allow ? ALLOW : DENY);
    }
  }
}

function windowFor(browser) {
  return browser?.ownerGlobal?.Breached ? browser.ownerGlobal : Services.wm.getMostRecentWindow("breached:main");
}

/**
 * Asks about kinds of access for a site in its tab. Resolves true to allow.
 * Answers already saved are used without asking.
 */
export async function decide(browser, principal, kinds, { text } = {}) {
  let known = saved(principal, kinds);
  if (known) {
    return known == "allow";
  }
  let shell = windowFor(browser)?.Breached;
  if (!shell) {
    return false;
  }
  let what = text ?? joinAsks(kinds);
  let answer = await shell.askPermission(browser, {
    host: hostOf(principal),
    what,
    // Private windows leave nothing behind, answers included.
    canRemember: !principal.privateBrowsingId && kinds.every(k => !KINDS[k]?.once),
  });
  let allow = answer == "allow" || answer == "always";
  if (answer == "always" || answer == "never") {
    remember(principal, kinds, allow);
  }
  return allow;
}

function joinAsks(kinds) {
  if (kinds.includes("camera") && kinds.includes("microphone")) {
    return "use your camera and microphone";
  }
  return kinds.map(k => KINDS[k]?.asks ?? `use "${k}"`).join(" and ");
}

/** Every saved answer, newest first: { origin, kind, name, allow, principal }. */
export function list() {
  return Services.perms.all
    .filter(p => REMEMBERED.includes(p.type) && (p.capability == ALLOW || p.capability == DENY))
    .sort((a, b) => b.modificationTime - a.modificationTime)
    .map(p => ({
      origin: p.principal.origin,
      host: hostOf(p.principal),
      kind: p.type,
      name: KINDS[p.type].name,
      allow: p.capability == ALLOW,
      principal: p.principal,
    }));
}

export function forget(principal, kind) {
  Services.perms.removeFromPrincipal(principal, kind);
}

// ------------------------------------------------- camera, microphone, screen

/** Answers one getUserMedia request: picks devices and tells the page. */
async function mediaRequest(actor, request) {
  let browser = actor.browsingContext.top.embedderElement;
  let principal = actor.manager.documentPrincipal;
  let shell = windowFor(browser)?.Breached;
  let byType = type => request.devices.filter(d => d.type == type);
  let cameras = byType("videoinput");
  let mics = byType("audioinput");
  let speakers = byType("audiooutput");
  let kinds = [];
  if (cameras.length) {
    kinds.push(request.screen ? "screen" : "camera");
  }
  if (mics.length) {
    kinds.push(request.audioCapture ? "audio-capture" : "microphone");
  }
  if (speakers.length) {
    kinds.push("speaker");
  }
  let reply = devices => {
    if (!actor.manager?.isClosed) {
      actor.sendAsyncMessage(devices ? "Media:Allow" : "Media:Deny", { callID: request.callID, devices });
    }
  };
  if (!shell || !(await decide(browser, principal, kinds))) {
    reply(null);
    return;
  }
  // One device of each kind: the only one, or the user's pick.
  let chosen = [];
  for (let [list, label] of [
    [cameras, request.screen ? "share" : "camera"],
    [mics, "microphone"],
    [speakers, "speakers"],
  ]) {
    if (!list.length) {
      continue;
    }
    let device = list[0];
    if (list.length > 1) {
      let picked = await shell.pickForTab(
        browser,
        `${label}:`,
        list.map(d => ({ label: d.name || d.mediaSource, detail: d.scary ? "a whole tab, careful" : d.mediaSource, device: d }))
      );
      if (!picked) {
        reply(null);
        return;
      }
      device = picked.device;
    }
    chosen.push(device.index);
  }
  reply(chosen);
}

export class BreachedPermissionsParent extends JSWindowActorParent {
  receiveMessage(message) {
    let browser = this.browsingContext.top.embedderElement;
    let shell = windowFor(browser)?.Breached;
    switch (message.name) {
      case "Media:Request":
        mediaRequest(this, message.data).catch(e => {
          console.error("Breached media request", e);
          this.sendAsyncMessage("Media:Deny", { callID: message.data.callID });
        });
        break;
      case "Media:Cancel":
        shell?.cancelPermission(browser);
        break;
      case "Media:State":
        shell?.setCapture(browser, message.data);
        break;
      case "EME:Request":
        // The Protected video mod handles it, or Breached offers that mod.
        if (shell && browser) {
          Promise.resolve(
            shell.mods.protectedVideo(browser, hostOf(this.manager.documentPrincipal), message.data)
          ).catch(e => console.error("Breached DRM request", e));
        }
        break;
    }
  }
}

// ------------------------------------------- everything else (Gecko prompts)

const prompter = {
  QueryInterface: ChromeUtils.generateQI(["nsIContentPermissionPrompt"]),

  prompt(request) {
    let types = request.types.QueryInterface(Ci.nsIArray);
    let kinds = [];
    for (let i = 0; i < types.length; i++) {
      kinds.push(kindFor(types.queryElementAt(i, Ci.nsIContentPermissionType).type));
    }
    let principal = request.principal;
    let text;
    if (kinds.includes("storage-access")) {
      // A site embedded in the page wants its own cookies here.
      text = `use its cookies on ${hostOf(request.topLevelPrincipal)}`;
    }
    let browser = request.element;
    decide(browser, principal, kinds, { text }).then(
      allow => {
        if (allow) {
          let choices = {};
          if (kinds.includes("storage-access")) {
            choices["storage-access"] = "allow";
          }
          request.allow(choices);
        } else {
          request.cancel();
        }
      },
      e => {
        console.error("Breached permission prompt", e);
        request.cancel();
      }
    );
  },
};

const PROMPT_CID = Components.ID("{9a3c1b0e-5d2f-4c7a-8e61-b2eac4ed0102}");
let initialized = false;

/** Registers the actors and the prompt. Safe to call from every window. */
export function init() {
  if (initialized) {
    return;
  }
  initialized = true;
  ChromeUtils.registerProcessActor("BreachedMedia", {
    child: {
      esModuleURI: "resource://breached/PermissionsChild.sys.mjs",
      observers: [
        "getUserMedia:request",
        "PeerConnection:request",
        "recording-device-events",
        "recording-window-ended",
        "mediakeys-request",
      ],
    },
    safeForUntrustedWebProcess: true,
  });
  ChromeUtils.registerWindowActor("BreachedPermissions", {
    parent: { esModuleURI: "resource://breached/Permissions.sys.mjs" },
    child: { esModuleURI: "resource://breached/PermissionsChild.sys.mjs" },
    allFrames: true,
    messageManagerGroups: ["browsers"],
    safeForUntrustedWebProcess: true,
  });
  let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  registrar.registerFactory(PROMPT_CID, "Breached permission prompt", "@mozilla.org/content-permission/prompt;1", {
    QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
    createInstance(iid) {
      return prompter.QueryInterface(iid);
    },
  });
}
