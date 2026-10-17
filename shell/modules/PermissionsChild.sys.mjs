/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The web page side of camera, microphone and screen sharing requests.
//
// Gecko announces getUserMedia() calls with observer notifications in the
// page's process (Firefox's front end answers them in WebRTCChild). The
// BreachedMedia process actor hears them, keeps the offered devices, and
// asks the browser window through the page's BreachedPermissions actor.
// The answer names the devices to use, by index.

const MediaManager = () => Cc["@mozilla.org/mediaManagerService;1"].getService(Ci.nsIMediaManagerService);

// callID -> the nsIMediaDevice objects offered to the user
const pending = new Map();

function actorFor(window) {
  try {
    return window?.windowGlobalChild?.getActor("BreachedPermissions") ?? null;
  } catch (e) {
    // No actor for this window (a parent process page).
    return null;
  }
}

function deny(callID) {
  pending.delete(callID);
  Services.obs.notifyObservers(null, "getUserMedia:response:deny", callID);
}

function handleRequest(request) {
  let window = Services.wm.getOuterWindowWithId(request.windowID);
  let constraints = request.getConstraints();
  let video = constraints.video || constraints.picture;
  let audio = constraints.audio;
  let screen = !!video && typeof video != "boolean" && video.mediaSource != "camera";
  let audioCapture = !!audio && typeof audio != "boolean" && audio.mediaSource != "microphone";

  let devices = [];
  let offered = [];
  for (let device of request.devices) {
    device = device.QueryInterface(Ci.nsIMediaDevice);
    let wanted =
      (device.type == "videoinput" && video && (device.mediaSource == "camera") != screen) ||
      (device.type == "audioinput" && audio && (device.mediaSource == "microphone") != audioCapture) ||
      (device.type == "audiooutput" && request.type == "selectaudiooutput");
    if (wanted) {
      offered.push({
        index: devices.length,
        type: device.type,
        mediaSource: device.mediaSource,
        name: device.rawName,
        scary: !!device.scary,
      });
      devices.push(device);
    }
  }
  let actor = actorFor(window);
  if (!offered.length || !actor) {
    deny(request.callID);
    return;
  }
  pending.set(request.callID, devices);
  window.addEventListener(
    "unload",
    () => {
      if (pending.has(request.callID)) {
        pending.delete(request.callID);
        try {
          actor.sendAsyncMessage("Media:Cancel", { callID: request.callID });
        } catch (e) {
          // Already gone; the window drops the question when the tab closes.
        }
      }
    },
    { once: true }
  );
  actor.sendAsyncMessage("Media:Request", {
    callID: request.callID,
    windowID: request.windowID,
    origin: window.document.nodePrincipal.origin,
    secure: request.isSecure,
    screen,
    audioCapture,
    devices: offered,
  });
}

/** Camera, microphone and screen in use by a page, for the tab's mark. */
function captureState(window) {
  let camera = {},
    microphone = {},
    screen = {},
    win = {},
    browser = {},
    devices = {};
  MediaManager().mediaCaptureWindowState(window, camera, microphone, screen, win, browser, devices);
  const off = Ci.nsIMediaManagerService.STATE_NOCAPTURE;
  return {
    camera: camera.value != off,
    microphone: microphone.value != off,
    screen: screen.value != off || win.value != off || browser.value != off,
  };
}

function reportCapture(window, ended = false) {
  let actor = actorFor(window);
  if (!actor) {
    return;
  }
  try {
    let state = ended ? { camera: false, microphone: false, screen: false } : captureState(window);
    actor.sendAsyncMessage("Media:State", { windowID: window.windowGlobalChild.innerWindowId, ...state });
  } catch (e) {
    // The page is closing; its tab mark goes with it.
  }
}

/** Process actor: hears Gecko's media notifications in each page process. */
export class BreachedMediaChild extends JSProcessActorChild {
  observe(subject, topic, data) {
    switch (topic) {
      case "getUserMedia:request":
        handleRequest(subject);
        break;
      case "PeerConnection:request":
        // Firefox lets every page make WebRTC connections unless an add-on
        // objects; Breached does the same.
        Services.obs.notifyObservers(null, "PeerConnection:response:allow", subject.callID);
        break;
      case "recording-device-events":
        if (subject instanceof Ci.nsIPropertyBag) {
          let window = subject.getProperty("window");
          if (window) {
            reportCapture(window);
          }
        }
        break;
      case "mediakeys-request": {
        // A page wants protected video (DRM); Drm.sys.mjs decides.
        let window = subject;
        let actor = actorFor(window);
        try {
          let { keySystem, status } = JSON.parse(data);
          actor?.sendAsyncMessage("EME:Request", { keySystem, status });
        } catch (e) {
          // A closing page.
        }
        break;
      }
      case "recording-window-ended": {
        let window = Services.wm.getOuterWindowWithId(data);
        if (window) {
          reportCapture(window, true);
        }
        break;
      }
    }
  }
}

/** Window actor: carries one page's requests to the browser window. */
export class BreachedPermissionsChild extends JSWindowActorChild {
  receiveMessage(message) {
    let { callID } = message.data;
    switch (message.name) {
      case "Media:Allow": {
        let devices = pending.get(callID);
        pending.delete(callID);
        if (!devices) {
          return;
        }
        let allowed = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
        for (let index of message.data.devices) {
          allowed.appendElement(devices[index]);
        }
        Services.obs.notifyObservers(allowed, "getUserMedia:response:allow", callID);
        break;
      }
      case "Media:Deny":
        deny(callID);
        break;
    }
  }
}
