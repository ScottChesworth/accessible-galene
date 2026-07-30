// Copyright (c) 2020 by Juliusz Chroboczek.

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

/**
 * The name of the group that we join.
 *
 * @type {string}
 */
let group;

/**
 * The connection to the server.
 *
 * @type {ServerConnection}
 */
let serverConnection;

/**
 * The group status.  This is set twice, once over HTTP in the start
 * function in order to obtain the WebSocket address, and a second time
 * after joining.
 *
 * @type {Record<string,any>}
 */
let groupStatus = {};

/**
 * True if we need to request a password.
 *
 * @type {boolean}
 */
let pwAuth = false;

/**
 * The token we use to login.  This is erased as soon as possible.
 *
 * @type {string}
 */
let token = null;

/**
 * The state of the login automaton.
 *
 * @type {"probing" | "need-username" | "success"}
 */
let probingState = null;

/**
 * getElementById, then assert that the result is an HTMLSelectElement.
 *
 * @param {string} id
 */
function getSelectElement(id) {
    let elt = document.getElementById(id);
    if(!elt || !(elt instanceof HTMLSelectElement))
        throw new Error(`Couldn't find ${id}`);
    return elt;
}

/**
 * getElementById, then assert that the result is an HTMLInputElement.
 *
 * @param {string} id
 */
function getInputElement(id) {
    let elt = document.getElementById(id);
    if(!elt || !(elt instanceof HTMLInputElement))
        throw new Error(`Couldn't find ${id}`);
    return elt;
}

/**
 * getElementById, then assert that the result is an HTMLButtonElement.
 *
 * @param {string} id
 */
function getButtonElement(id) {
    let elt = document.getElementById(id);
    if(!elt || !(elt instanceof HTMLButtonElement))
        throw new Error(`Couldn't find ${id}`);
    return elt;
}

/**
 * Earcon types: internal name and human-readable label.
 */
const earconTypes = [
    {name: 'muted', label: 'Mute'},
    {name: 'unmuted', label: 'Microphone on'},
    {name: 'raise', label: 'Raise hand'},
    {name: 'lower', label: 'Lower hand'},
    {name: 'notify', label: 'Another participant raises a hand'},
    {name: 'joined', label: 'Participant joined'},
    {name: 'left', label: 'Participant left'},
];

/**
 * The settings key that enables a given earcon.
 * @param {string} name
 * @returns {string}
 */
function earconSettingKey(name) {
    return 'earcon' + name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Whether the initial user list has settled after joining, so that
 * later joins and leaves can be reported without a flood on entry.
 */
let usersReady = false;
let usersReadyTimer = null;

/**
 * @returns {boolean} whether the current user is an operator.
 */
function isOp() {
    return !!(serverConnection && serverConnection.permissions &&
              serverConnection.permissions.indexOf('op') >= 0);
}

/**
 * Ensure that the UI reflects the stored settings.
 */
function reflectSettings() {
    let settings = getSettings();
    let store = false;

    setLocalMute(settings.localMute);

    let videoselect = getSelectElement('videoselect');
    if(!settings.hasOwnProperty('video') ||
       !selectOptionAvailable(videoselect, settings.video)) {
        settings.video = selectOptionDefault(videoselect);
        store = true;
    }
    videoselect.value = settings.video;

    let audioselect = getSelectElement('audioselect');
    if(!settings.hasOwnProperty('audio') ||
       !selectOptionAvailable(audioselect, settings.audio)) {
        settings.audio = selectOptionDefault(audioselect);
        store = true;
    }
    audioselect.value = settings.audio;

    if(settings.hasOwnProperty('filter')) {
        getSelectElement('filterselect').value = settings.filter;
    } else {
        let s = getSelectElement('filterselect').value;
        if(s) {
            settings.filter = s;
            store = true;
        }
    }

    if(settings.hasOwnProperty('request')) {
        getSelectElement('requestselect').value = settings.request;
    } else {
        settings.request = getSelectElement('requestselect').value;
        store = true;
    }

    if(settings.hasOwnProperty('send')) {
        getSelectElement('sendselect').value = settings.send;
    } else {
        settings.send = getSelectElement('sendselect').value;
        store = true;
    }

    if(settings.hasOwnProperty('simulcast')) {
        getSelectElement('simulcastselect').value = settings.simulcast
    } else {
        settings.simulcast = getSelectElement('simulcastselect').value;
        store = true;
    }

    if(settings.hasOwnProperty('blackboardMode')) {
        getInputElement('blackboardbox').checked = settings.blackboardMode;
    } else {
        settings.blackboardMode = getInputElement('blackboardbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('mirrorView')) {
        getInputElement('mirrorbox').checked = settings.mirrorView;
    } else {
        settings.mirrorView = getInputElement('mirrorbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('activityDetection')) {
        getInputElement('activitybox').checked = settings.activityDetection;
    } else {
        settings.activityDetection = getInputElement('activitybox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('displayAll')) {
        getInputElement('displayallbox').checked = settings.displayAll;
    } else {
        settings.displayAll = getInputElement('displayallbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('preprocessing')) {
        getInputElement('preprocessingbox').checked = settings.preprocessing;
    } else {
        settings.preprocessing = getInputElement('preprocessingbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('hqaudio'))
        getInputElement('hqaudiobox').checked = settings.hqaudio;

    for(let t of earconTypes) {
        let box = document.getElementById('earcon-' + t.name);
        if(box)
            box.checked = settings[earconSettingKey(t.name)] !== false;
    }

    let ajl = document.getElementById('announce-joinleave');
    if(ajl)
        ajl.checked = settings.announceJoinLeave !== false;

    if(store)
        storeSettings(settings);
}

/**
 * Returns true if we should use the mobile layout.  This should be kept
 * in sync with the CSS.
 */
function isMobileLayout() {
    return !!window.matchMedia('only screen and (max-width: 1024px)').matches
}

/**
 * Conditionally hide the video pane.  If force is true, hide it even if
 * there are videos.
 *
 * @param {boolean} [force]
 */
function hideVideo(force) {
    let mediadiv = document.getElementById('peers');
    if(mediadiv.childElementCount > 0 && !force)
        return;
    setVisibility('video-container', false);
    scheduleReconsiderDownRate();
}

/**
 * Show the video pane.
 */
function showVideo() {
    let hasmedia = document.getElementById('peers').childElementCount > 0;
    if(isMobileLayout()) {
        setVisibility('show-video', false);
        setVisibility('collapse-video', hasmedia);
    }
    setVisibility('video-container', hasmedia);
    scheduleReconsiderDownRate();
}

/**
 * Returns true if we are running on Safari.
 */
function isSafari() {
    let ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('safari') >= 0 && ua.indexOf('chrome') < 0;
}

/**
 * Returns true if we are running on Firefox.
 */
function isFirefox() {
    let ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('firefox') >= 0;
}

/**
 * setConnected is called whenever we connect or disconnect to the server.
 *
 * @param{boolean} connected
 */
function setConnected(connected) {
    let userbox = document.getElementById('profile');
    let connectionbox = document.getElementById('login-container');
    if(connected) {
        clearChat();
        userbox.classList.remove('invisible');
        connectionbox.classList.add('invisible');
        displayUsername();
        window.onresize = function(e) {
            scheduleReconsiderDownRate();
        }
    } else {
        userbox.classList.add('invisible');
        connectionbox.classList.remove('invisible');
        hideVideo();
        window.onresize = null;
    }
}

/**
 * Called when we connect to the server.
 *
 * @this {ServerConnection}
 */
async function gotConnected() {
    setConnected(true);
    await join();
}

/**
 * Sets the href field of the "change password" link.
 *
 * @param {string} username
 */
function setChangePassword(username) {
    let s = document.getElementById('chpwspan');
    let a = s.children[0];
    if(!(a instanceof HTMLAnchorElement))
        throw new Error('Bad type for chpwspan');
    if(username) {
        a.href = `/change-password.html?group=${encodeURIComponent(group)}&username=${encodeURIComponent(username)}`;
        a.target = '_blank';
        s.classList.remove('invisible');
    } else {
        a.href = null;
        s.classList.add('invisible');
    }
}

/**
 * Join a group.
 */
async function join() {
    let username = getInputElement('username').value.trim();
    let credentials;
    if(token) {
        pwAuth = false;
        credentials = {
            type: 'token',
            token: token,
        };
        switch(probingState) {
        case null:
            // when logging in with a token, we need to give the user
            // a chance to interact with the page in order to enable
            // autoplay.  Probe the group first in order to determine if
            // we need a username.  We should really extend the protocol
            // to have a simpler protocol for probing.
            probingState = 'probing';
            username = null;
            break;
        case 'need-username':
        case 'success':
            probingState = null;
            break
        default:
            console.warn(`Unexpected probing state ${probingState}`);
            probingState = null;
            break;
        }
    } else {
        if(probingState !== null) {
            console.warn(`Unexpected probing state ${probingState}`);
            probingState = null;
        }
        let pw = getInputElement('password').value;
        getInputElement('password').value = '';
        if(!groupStatus.authServer) {
            pwAuth = true;
            credentials = pw;
        } else {
            pwAuth = false;
            credentials = {
                type: 'authServer',
                authServer: groupStatus.authServer,
                location: location.href,
                password: pw,
            };
        }
    }

    try {
        await serverConnection.join(group, username, credentials);
    } catch(e) {
        console.error(e);
        displayError(e);
        serverConnection.close();
    }
}

/**
 * @this {ServerConnection}
 */
function onPeerConnection() {
    if(!getSettings().forceRelay)
        return null;
    let old = this.rtcConfiguration;
    /** @type {RTCConfiguration} */
    let conf = {};
    for(let key in old)
        conf[key] = old[key];
    conf.iceTransportPolicy = 'relay';
    return conf;
}

/**
 * @this {ServerConnection}
 * @param {number} code
 * @param {string} reason
 */
function gotClose(code, reason) {
    closeUpMedia();
    closeSafariStream();
    setConnected(false);
    if(code !== 1000) {
        console.warn('Socket close', code, reason);
    }
    let form = document.getElementById('loginform');
    if(!(form instanceof HTMLFormElement))
        throw new Error('Bad type for loginform');
}

/**
 * @this {ServerConnection}
 * @param {Stream} c
 */
function gotDownStream(c) {
    c.onclose = function(replace) {
        if(!replace)
            delMedia(c.localId);
    };
    c.onerror = function(e) {
        console.error(e);
        displayError(e);
    };
    c.ondowntrack = function(track, transceiver, stream) {
        setMedia(c);
    };
    c.onnegotiationcompleted = function() {
        resetMedia(c);
    }
    c.onstatus = function(status) {
        setMediaStatus(c);
    };
    c.onstats = gotDownStats;
    if(getSettings().activityDetection)
        c.setStatsInterval(activityDetectionInterval);

    setMedia(c);
}

// Store current browser viewport height in css variable
function setViewportHeight() {
    document.documentElement.style.setProperty(
        '--vh', `${window.innerHeight/100}px`,
    );
    if (!getVisibility('left')) {
        showVideo();
    }
    // Ajust video component size
    resizePeers();
}

// On resize and orientation change, we update viewport height
addEventListener('resize', setViewportHeight);
addEventListener('orientationchange', setViewportHeight);

getButtonElement('presentbutton').onclick = async function(e) {
    e.preventDefault();
    let button = this;
    if(!(button instanceof HTMLButtonElement))
        throw new Error('Unexpected type for this.');
    // there's a potential race condition here: the user might click the
    // button a second time before the stream is set up and the button hidden.
    button.disabled = true;
    try {
        let id = findUpMedia('camera');
        if(!id)
            await addLocalMedia();
    } finally {
        button.disabled = false;
    }
};

getButtonElement('unpresentbutton').onclick = function(e) {
    e.preventDefault();
    closeUpMedia('camera');
    resizePeers();
};

/**
 * @param {string} id
 * @param {boolean} visible
 */
function setVisibility(id, visible) {
    let elt = document.getElementById(id);
    if(visible)
        elt.classList.remove('invisible');
    else
        elt.classList.add('invisible');
}

/**
 * getVisibility tells whether specified element is visible.
 *
 * @param {string} id
 */
function getVisibility(id) {
    let elt = document.getElementById(id);
    return !elt.classList.contains('invisible');
}

/**
 * Shows and hides various UI elements depending on the protocol state.
 */
function setButtonsVisibility() {
    let connected = serverConnection && serverConnection.socket;
    let permissions = serverConnection.permissions;
    let canWebrtc = !(typeof RTCPeerConnection === 'undefined');
    let canPresent = canWebrtc &&
        ('mediaDevices' in navigator) &&
        ('getUserMedia' in navigator.mediaDevices) &&
        permissions.indexOf('present') >= 0;
    let canShare = canWebrtc &&
        ('mediaDevices' in navigator) &&
        ('getDisplayMedia' in navigator.mediaDevices) &&
        permissions.indexOf('present') >= 0;
    let local = !!findUpMedia('camera');
    let mediacount = document.getElementById('peers').childElementCount;
    let mobilelayout = isMobileLayout();

    // don't allow multiple presentations
    setVisibility('presentbutton', canPresent && !local);
    setVisibility('unpresentbutton', local);

    setVisibility('mutebutton', !connected || canPresent);
    setVisibility('micgain-item', !connected || canPresent);

    setVisibility('raisehandbutton', connected);

    // allow multiple shared documents
    setVisibility('sharebutton', canShare);

    setVisibility('mediaoptions', canPresent);
    setVisibility('sendform', canPresent);
    setVisibility('simulcastform', canPresent);

    setVisibility('op-cues', connected && isOp());

    setVisibility('collapse-video', mediacount && mobilelayout);
}

/**
 * Sets the local mute state.  If reflect is true, updates the stored settings.
 *
 * @param {boolean} mute
 * @param {boolean} [reflect]
 */
function setLocalMute(mute, reflect) {
    muteLocalTracks(mute);
    let button = document.getElementById('mutebutton');
    let icon = button.querySelector('.fas');
    // Pressed = microphone on; not pressed = muted.  Keep the label
    // fixed ("Microphone"), exactly like the raise-hand button: changing
    // the accessible name on toggle made screen readers re-announce the
    // button on top of the polite status message (doubled speech).  The
    // icon is aria-hidden, so swapping it is silent.
    button.setAttribute('aria-pressed', mute ? 'false' : 'true');
    if(icon) {
        icon.classList.toggle('fa-microphone-slash', mute);
        icon.classList.toggle('fa-microphone', !mute);
    }
    if(reflect)
        updateSettings({localMute: mute});
}

getSelectElement('videoselect').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({video: this.value});
    replaceCameraStream();
};

getSelectElement('audioselect').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({audio: this.value});
    replaceCameraStream();
};

getInputElement('mirrorbox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({mirrorView: this.checked});
    // no need to reopen the camera
    replaceUpStreams('camera');
};

getInputElement('blackboardbox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({blackboardMode: this.checked});
    replaceCameraStream();
};

getInputElement('preprocessingbox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({preprocessing: this.checked});
    replaceCameraStream();
};

getInputElement('hqaudiobox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({hqaudio: this.checked});
    replaceCameraStream();
};

for(let t of earconTypes) {
    let box = document.getElementById('earcon-' + t.name);
    if(box)
        box.onchange = function() {
            updateSettings({[earconSettingKey(t.name)]: this.checked});
        };
}

{
    let ajl = document.getElementById('announce-joinleave');
    if(ajl)
        ajl.onchange = function() {
            updateSettings({announceJoinLeave: this.checked});
        };
}

/**
 * Apply a mute state with the usual feedback (earcon + polite
 * announcement).  Shared by the button, the Ctrl+M shortcut and
 * push-to-talk.
 * @param {boolean} mute
 */
function setMicMuted(mute) {
    setLocalMute(mute, true);
    playEarcon(mute ? 'muted' : 'unmuted');
    if(!mute && !findUpMedia('camera'))
        announcePolite('Microphone unmuted, but not started yet. Press the Enable button to start it; your browser will ask for permission.');
    else
        announcePolite(mute ? 'Microphone muted' : 'Microphone on');
}

function toggleMic() {
    setMicMuted(!getSettings().localMute);
}

// Push-to-talk hold state.  pttKeyHeld: Ctrl+M is being held; pttButtonHeld:
// the mute button is being held with a pointer.
let pttKeyHeld = false;
let pttButtonHeld = false;

document.getElementById('mutebutton').onclick = function(e) {
    e.preventDefault();
    if(getSettings().micMode === 'ptt') {
        // Mouse/touch uses press-and-hold (pointer handlers below).  A
        // keyboard activation (Enter/Space) reports detail 0 and can't
        // "hold", so fall back to a plain toggle for keyboard users.
        if(e.detail === 0)
            toggleMic();
        return;
    }
    toggleMic();
};

// Press-and-hold the mute button for push-to-talk (pointer only).
document.getElementById('mutebutton').addEventListener('pointerdown', function(e) {
    if(getSettings().micMode !== 'ptt')
        return;
    if(!pttButtonHeld && getSettings().localMute) {
        pttButtonHeld = true;
        setMicMuted(false);
    }
});
window.addEventListener('pointerup', function(e) {
    if(pttButtonHeld) {
        pttButtonHeld = false;
        setMicMuted(true);
    }
});

// Microphone input level.  Reflects the stored setting and, while the
// mic is live, adjusts the gain node in real time.  The slider stores
// its value even before the mic starts, so it takes effect on the next
// stream.
{
    let micgain = getInputElement('micgain');
    if(micgain) {
        let g = getSettings().micGain;
        micgain.value = String(typeof g === 'number' ? g : 100);
        micgain.oninput = function() {
            // The native range control announces its own value to the
            // screen reader, so no explicit announcement here.
            setMicGain(parseFloat(this.value));
        };
    }
}

// Microphone mode: toggle (default) vs push-to-talk.
{
    let toggleRadio = getInputElement('micmode-toggle');
    let pttRadio = getInputElement('micmode-ptt');
    if(toggleRadio && pttRadio) {
        let ptt = getSettings().micMode === 'ptt';
        toggleRadio.checked = !ptt;
        pttRadio.checked = ptt;
        let onchange = function() {
            let m = pttRadio.checked ? 'ptt' : 'toggle';
            updateSettings({micMode: m});
            // Push-to-talk rests muted: make sure the mic isn't left open
            // when the mode is selected.
            if(m === 'ptt' && !getSettings().localMute)
                setMicMuted(true);
        };
        toggleRadio.onchange = onchange;
        pttRadio.onchange = onchange;
    }
}

/**
 * @param {boolean} raised
 */
function setRaiseHandButton(raised) {
    let button = document.getElementById('raisehandbutton');
    if(button)
        button.setAttribute('aria-pressed', raised ? 'true' : 'false');
}

getButtonElement('raisehandbutton').onclick = function(e) {
    e.preventDefault();
    let newRaised = this.getAttribute('aria-pressed') !== 'true';
    serverConnection.userAction(
        'setdata', serverConnection.id,
        {'raisehand': newRaised ? true : null},
    );
    setRaiseHandButton(newRaised);
    playEarcon(newRaised ? 'raise' : 'lower');
    announcePolite(newRaised ? 'Hand raised' : 'Hand lowered');
};

/**
 * Global keyboard shortcuts, active from anywhere in the window:
 * Ctrl+H toggles the raised hand; Ctrl+M controls the microphone.  In
 * toggle mode Ctrl+M switches the mic on/off; in push-to-talk mode it
 * unmutes while held (see the keyup handler for the release).  Each is
 * gated on its button being visible (i.e. the action applies).
 */
document.addEventListener('keydown', function(e) {
    if(e.repeat || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey)
        return;
    let key = e.key.toLowerCase();
    if(key === 'h') {
        if(!getVisibility('raisehandbutton'))
            return;
        e.preventDefault();
        document.getElementById('raisehandbutton').click();
    } else if(key === 'm') {
        if(!getVisibility('mutebutton'))
            return;
        e.preventDefault();
        if(getSettings().micMode === 'ptt') {
            if(!pttKeyHeld && getSettings().localMute) {
                pttKeyHeld = true;
                setMicMuted(false);
            }
        } else {
            toggleMic();
        }
    }
});

// Push-to-talk release: re-mute when Ctrl+M is let go.  We match on the
// 'm' key alone, since Control may be released first.  A window blur is a
// safety net so the mic can't stay open if focus is lost mid-hold.
document.addEventListener('keyup', function(e) {
    if(pttKeyHeld && e.key.toLowerCase() === 'm') {
        pttKeyHeld = false;
        setMicMuted(true);
    }
});
window.addEventListener('blur', function() {
    if(pttKeyHeld || pttButtonHeld) {
        pttKeyHeld = false;
        pttButtonHeld = false;
        setMicMuted(true);
    }
});

/**
 * Global microphone-level shortcuts: Ctrl+Shift+Up and Ctrl+Shift+Down
 * nudge the mic gain by 5% and announce the new value (value first, so
 * the changing number is heard immediately on repeated presses).
 */
document.addEventListener('keydown', function(e) {
    if(e.repeat || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey)
        return;
    let delta;
    switch(e.key) {
    case 'ArrowUp': delta = 5; break;
    case 'ArrowDown': delta = -5; break;
    default: return;
    }
    if(!getVisibility('micgain-item'))
        return;
    e.preventDefault();
    let g = getSettings().micGain;
    if(typeof g !== 'number')
        g = 100;
    let v = setMicGain(g + delta);
    announcePolite(`${v}% microphone level`);
});

/**
 * Whether the native/app-style GUI is active (set by ui-mode.js from the
 * ?ui= switch, a remembered choice, or standalone launch).
 * @returns {boolean}
 */
function uiIsNative() {
    return document.documentElement.getAttribute('data-ui') === 'native';
}

/**
 * The first visible control in the toolbar, or null.
 * @returns {HTMLElement}
 */
function firstVisibleToolbarControl() {
    let menu = document.querySelector('.nav-menu');
    if(!menu)
        return null;
    let items = menu.querySelectorAll(
        'button, input, [role="button"], .nav-button',
    );
    for(let it of items) {
        if(it instanceof HTMLElement && it.offsetParent !== null)
            return it;
    }
    return null;
}

/**
 * The main panes, in cycle order, that currently exist and are visible.
 * @returns {{name: string, el: HTMLElement}[]}
 */
function uiPanes() {
    let users = document.getElementById('users');
    let box = document.getElementById('box');
    let panes = [
        {name: 'Toolbar', el: firstVisibleToolbarControl()},
        // Land on the current (real-focus) item of each list.
        {name: 'Participants', el: users && rovingTarget(users)},
        {name: 'Chat', el: box && rovingTarget(box)},
        {name: 'Message', el: document.getElementById('input')},
    ];
    return panes.filter(p => p.el instanceof HTMLElement &&
                        p.el.offsetParent !== null);
}

/**
 * @param {{name: string, el: HTMLElement}} pane
 */
function focusPane(pane) {
    let el = pane.el;
    let nativelyFocusable =
        /^(BUTTON|INPUT|A|SELECT|TEXTAREA)$/.test(el.tagName);
    if(!nativelyFocusable && el.tabIndex < 0)
        el.tabIndex = -1;
    el.focus();
    announcePolite(pane.name);
}

/**
 * Native-app-style pane cycling: F6 and Shift+F6 move focus between the
 * main regions (toolbar, participants, chat, message box) and announce
 * where you land, the way a desktop app cycles panes.  Only active in the
 * native UI mode; in a plain browser tab F6 may be claimed by the browser
 * (address bar), but it is free in the installed standalone window.
 */
document.addEventListener('keydown', function(e) {
    if(!uiIsNative())
        return;
    if(e.key !== 'F6' || e.ctrlKey || e.altKey || e.metaKey)
        return;
    let panes = uiPanes();
    if(panes.length === 0)
        return;
    e.preventDefault();
    let active = document.activeElement;
    let idx = panes.findIndex(
        p => p.el === active || p.el.contains(active),
    );
    let dir = e.shiftKey ? -1 : 1;
    let next;
    if(idx === -1)
        next = dir === 1 ? panes[0] : panes[panes.length - 1];
    else
        next = panes[(idx + dir + panes.length) % panes.length];
    focusPane(next);
});

// When the mode was set explicitly via ?ui=, confirm it out loud so the
// current interface is unambiguous while comparing across devices.
if(window.uiModeExplicit)
    setTimeout(() => announcePolite(
        uiIsNative() ? 'Native interface' : 'Web interface'), 600);

// Running counter for chat-message ids (aria-activedescendant).
let chatMsgSeq = 0;

/**
 * Turn a container into a keyboard-navigable widget with arrow-key
 * navigation.  Its item children (matched by isItem) are navigated with
 * Up/Down/Home/End; the container is the single tab stop and tracks the
 * current item with aria-activedescendant, so a screen reader enters focus
 * mode and announces each item as you arrow.  Enter/Space/Menu runs
 * activate() on the current item.
 *
 * containerRole is "listbox" for a selectable list (participants) or
 * "application" for the chat, where "listbox" would make the reader
 * announce an unwanted "N of M" position for every message.
 *
 * @param {HTMLElement} box
 * @param {(item: HTMLElement) => void} activate
 * @param {string} containerRole
 * @param {(el: HTMLElement) => boolean} isItem
 */
function setupListbox(box, activate, containerRole, isItem) {
    box.setAttribute('role', containerRole);
    box.tabIndex = -1;

    // All item children (visible or not).
    function items() {
        return Array.prototype.filter.call(box.children,
            c => c instanceof HTMLElement && isItem(c));
    }
    function visible() {
        return items().filter(c => c.getClientRects().length > 0);
    }
    // Move real DOM focus (not just aria-activedescendant) to an item, so a
    // screen reader's review cursor / navigator object follows it and its
    // text can be reviewed word/character by word.  Roving tabindex keeps
    // the list a single tab stop.
    function focusItem(it) {
        for(let o of items())
            o.setAttribute('tabindex', o === it ? '0' : '-1');
        if(it) {
            it.focus();
            it.scrollIntoView({block: 'nearest'});
        }
    }
    // Keep exactly one item as the roving tab stop (default to the last, the
    // newest message) so Tab and F6 land in the list.  Runs as items are
    // added, removed, or reordered.
    function ensureTabStop() {
        let all = items();
        if(all.length === 0)
            return;
        if(!all.some(o => o.getAttribute('tabindex') === '0'))
            all[all.length - 1].setAttribute('tabindex', '0');
        for(let o of all)
            if(o.getAttribute('tabindex') !== '0')
                o.setAttribute('tabindex', '-1');
    }
    new MutationObserver(ensureTabStop).observe(box, {childList: true});
    ensureTabStop();

    box.addEventListener('keydown', function(e) {
        let opts = visible();
        if(opts.length === 0)
            return;
        let idx = opts.indexOf(
            /** @type{HTMLElement} */(document.activeElement));
        let next = idx;
        switch(e.key) {
        case 'ArrowDown': next = idx < 0 ? 0 : Math.min(opts.length - 1, idx + 1); break;
        case 'ArrowUp': next = idx < 0 ? opts.length - 1 : Math.max(0, idx - 1); break;
        case 'Home': next = 0; break;
        case 'End': next = opts.length - 1; break;
        case 'Enter':
        case ' ':
        case 'ContextMenu': {
            e.preventDefault();
            let target = idx >= 0 ? opts[idx] : opts[opts.length - 1];
            if(target && activate)
                activate(target);
            return;
        }
        default:
            return;
        }
        e.preventDefault();
        focusItem(opts[next]);
    });
}

/**
 * Web-mode chat list following the Slack "focusable list item" pattern: a
 * semantic list (role=list, listitem children) with a single roving
 * tabindex="0" so Tab and F6 land on the newest message, but WITHOUT any
 * custom arrow handling.  Navigation happens in the screen reader's browse
 * mode (virtual cursor), so items are read and reviewed inline line by line
 * and no focus-mode "N of M" position is announced.  Unlike a listbox this
 * keeps descendant roles (e.g. links) intact.  The operator menu opens on
 * the ContextMenu (applications) key on the focused message.
 * @param {HTMLElement} box
 * @param {(item: HTMLElement) => void} activate
 * @param {(c: HTMLElement) => boolean} isItem
 */
function setupBrowseList(box, activate, isItem) {
    box.setAttribute('role', 'list');
    function items() {
        return Array.prototype.filter.call(box.children,
            c => c instanceof HTMLElement && isItem(c));
    }
    // Keep exactly one item as the roving tab stop (the last, i.e. newest) so
    // Tab and F6 land in the list.  A tabindex on a non-widget listitem lets
    // focus land without switching the reader out of browse mode.
    function ensureTabStop() {
        let all = items();
        if(all.length === 0)
            return;
        if(!all.some(o => o.getAttribute('tabindex') === '0'))
            all[all.length - 1].setAttribute('tabindex', '0');
        for(let o of all)
            if(o.getAttribute('tabindex') !== '0')
                o.setAttribute('tabindex', '-1');
    }
    new MutationObserver(ensureTabStop).observe(box, {childList: true});
    ensureTabStop();

    function visible() {
        return items().filter(c => c.getClientRects().length > 0);
    }
    function focusItem(it) {
        for(let o of items())
            o.setAttribute('tabindex', o === it ? '0' : '-1');
        if(it) {
            it.focus();
            it.scrollIntoView({block: 'nearest'});
        }
    }

    box.addEventListener('keydown', function(e) {
        // In browse mode the screen reader consumes the arrows for its
        // virtual cursor, so this handler only fires in focus mode -- where
        // moving real focus is what makes arrow navigation work (at the cost
        // of a spoken position, inherent to focus mode).  Browse mode is
        // unaffected and stays free of the "N of M" count.
        let opts = visible();
        if(opts.length === 0)
            return;
        let idx = opts.indexOf(
            /** @type{HTMLElement} */(document.activeElement));
        let next = idx;
        switch(e.key) {
        case 'ArrowDown': next = idx < 0 ? 0 : Math.min(opts.length - 1, idx + 1); break;
        case 'ArrowUp': next = idx < 0 ? opts.length - 1 : Math.max(0, idx - 1); break;
        case 'Home': next = 0; break;
        case 'End': next = opts.length - 1; break;
        case 'Enter':
        case 'ContextMenu': {
            let it = idx >= 0 ? opts[idx] :
                /** @type{HTMLElement} */(document.activeElement);
            if(it && isItem(it) && activate) {
                e.preventDefault();
                activate(it);
            }
            return;
        }
        default:
            return;
        }
        e.preventDefault();
        focusItem(opts[next]);
    });
}

/**
 * The roving tab stop (real focus target) of a listbox/application set up by
 * setupListbox, or the container itself if it has no items yet.
 * @param {HTMLElement} box
 * @returns {HTMLElement}
 */
function rovingTarget(box) {
    if(!box)
        return box;
    let it = box.querySelector('[tabindex="0"]');
    return (it instanceof HTMLElement) ? it : box;
}

/**
 * Accessible popup menu: a real role="menu" with keyboard support (arrows,
 * Home/End, Enter via the button, Escape/Tab to close) and focus restored
 * to whatever was focused when it opened.  Replaces the mouse-only
 * Contextual popup for the participant and chat menus.  Consumes the same
 * items: {label, onClick} or {type:'seperator'}.  If opened by a mouse
 * event (ev), it appears at the pointer; otherwise near the focused anchor.
 *
 * @param {Array<{label?: string, onClick?: () => void, type?: string}>} items
 * @param {MouseEvent} [ev]
 */
function accessibleMenu(items, ev) {
    let returnFocus = /** @type{HTMLElement} */(document.activeElement);
    let menu = document.createElement('div');
    menu.className = 'a11y-menu';
    menu.setAttribute('role', 'menu');

    let entries = [];
    for(let it of items) {
        if(!it || it.type === 'seperator') {
            let sep = document.createElement('div');
            sep.setAttribute('role', 'separator');
            menu.appendChild(sep);
            continue;
        }
        let mi = document.createElement('button');
        mi.type = 'button';
        mi.setAttribute('role', 'menuitem');
        mi.tabIndex = -1;
        mi.textContent = it.label;
        mi.addEventListener('click', function() {
            close();
            if(it.onClick)
                it.onClick();
        });
        menu.appendChild(mi);
        entries.push(mi);
    }
    if(entries.length === 0)
        return;

    function close() {
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('pointerdown', onOutside, true);
        menu.remove();
        if(returnFocus && returnFocus.focus)
            returnFocus.focus();
    }
    function focusAt(i) {
        entries[(i + entries.length) % entries.length].focus();
    }
    function onKey(e) {
        let i = entries.indexOf(/** @type{HTMLElement} */(document.activeElement));
        switch(e.key) {
        case 'ArrowDown': e.preventDefault(); focusAt(i + 1); break;
        case 'ArrowUp': e.preventDefault(); focusAt(i - 1); break;
        case 'Home': e.preventDefault(); focusAt(0); break;
        case 'End': e.preventDefault(); focusAt(entries.length - 1); break;
        case 'Escape':
        case 'Tab': e.preventDefault(); close(); break;
        }
    }
    function onOutside(e) {
        if(!menu.contains(e.target))
            close();
    }

    let x, y;
    if(ev && ev.detail > 0 && typeof ev.clientX === 'number') {
        x = ev.clientX;
        y = ev.clientY;
    } else {
        let r = returnFocus && returnFocus.getBoundingClientRect ?
            returnFocus.getBoundingClientRect() : {left: 20, bottom: 20};
        x = r.left;
        y = r.bottom;
    }
    menu.style.position = 'fixed';
    menu.style.left = Math.round(x) + 'px';
    menu.style.top = Math.round(y) + 'px';
    document.body.appendChild(menu);
    // Keep it on-screen.
    let mr = menu.getBoundingClientRect();
    if(mr.right > window.innerWidth)
        menu.style.left = Math.max(0, window.innerWidth - mr.width) + 'px';
    if(mr.bottom > window.innerHeight)
        menu.style.top = Math.max(0, window.innerHeight - mr.height) + 'px';
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onOutside, true);
    focusAt(0);
}

// Chat is a browse-mode list (role="list" with role="listitem" messages),
// not a focus-mode widget.  Browse mode keeps the screen reader's virtual
// cursor available, so messages can be reviewed word/character by word and
// jumped between with the reader's built-in list-item navigation.  The
// container is a tab stop so it still has a landing spot; focusing a
// (non-widget) list does not switch the reader out of browse mode.
{
    let box = document.getElementById('box');
    let openMenu = opt => {
        let m = opt.querySelector('.message');
        if(m instanceof HTMLElement)
            chatMessageMenu(m);
    };
    let isRow = c => c.classList.contains('message-row');
    if(box && uiIsNative())
        // Native mode: an ARIA listbox navigated by moving real focus between
        // message options (see setupListbox) -- a tab stop and arrow-
        // navigable, and real focus lets the review cursor reach a message by
        // object navigation.  A screen reader announces "N of M" per option;
        // that is inherent to a focus-mode widget and can't be suppressed
        // from markup (nvaccess/nvda #9823).  The operator menu opens on Enter.
        setupListbox(box, openMenu, 'listbox', isRow);
    else if(box)
        // Web mode (prototype): a semantic list (role=list / listitem) that is
        // a tab stop via a roving tabindex, but navigated in the screen
        // reader's browse mode -- there is no real-focus arrow handler, so it
        // stays document content, not a focus-mode widget.  That keeps each
        // message readable/reviewable inline and drops the "N of M" position.
        setupBrowseList(box, openMenu, isRow);
}
// The participants list is a listbox, only in native mode.
if(uiIsNative()) {
    let users = document.getElementById('users');
    if(users)
        setupListbox(users, opt => userMenu(opt),
                     'listbox', c => c.getAttribute('role') === 'option');
}

// Keep the chat's live region announcing new messages but not the periodic
// relative-time updates: "additions" covers node additions (new messages)
// while ignoring in-place text changes (the time refresh).
{
    let box = document.getElementById('box');
    if(box)
        box.setAttribute('aria-relevant', 'additions');
}

/**
 * Visible, keyboard-focusable elements within the app, in document order.
 * The collapsed settings sidebar is excluded.
 * @returns {HTMLElement[]}
 */
function appFocusables() {
    let sidebar = document.getElementById('sidebarnav');
    let sidebarOpen = !!sidebar && sidebar.offsetWidth > 10;
    let out = [];
    let sel = 'a[href], button, input, select, textarea, [tabindex]';
    for(let el of document.querySelectorAll(sel)) {
        if(!(el instanceof HTMLElement))
            continue;
        if(el.tabIndex < 0 || el.matches('[disabled]'))
            continue;
        if(el.getClientRects().length === 0)   // display:none, etc.
            continue;
        if(!sidebarOpen && sidebar && sidebar.contains(el))
            continue;
        out.push(el);
    }
    return out;
}

/**
 * Native-app-style focus containment: in native mode, Tab and Shift+Tab
 * wrap around within the app rather than escaping into the browser, so the
 * control cycle feels bounded like a desktop window.  Only the wrap points
 * are intercepted; ordinary Tab moves and browse-mode arrows are untouched.
 */
document.addEventListener('keydown', function(e) {
    if(!uiIsNative() || e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey)
        return;
    let f = appFocusables();
    if(f.length < 2)
        return;
    let first = f[0];
    let last = f[f.length - 1];
    let active = document.activeElement;
    if(!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
    } else if(e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
    }
});

document.getElementById('sharebutton').onclick = function(e) {
    e.preventDefault();
    addShareMedia();
};

getSelectElement('filterselect').onchange = async function(e) {
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({filter: this.value});
    let c = findUpMedia('camera');
    if(c) {
        let filter = (this.value && filters[this.value]) || null;
        if(filter)
            c.userdata.filterDefinition = filter;
        else
            delete c.userdata.filterDefinition;
        replaceUpStream(c);
    }
};

/**
 * Returns the desired max video throughput depending on the settings.
 *
 * @returns {number}
 */
function getMaxVideoThroughput() {
    let v = getSettings().send;
    switch(v) {
    case 'lowest':
        return 150000;
    case 'low':
        return 300000;
    case 'normal':
        return 700000;
    case 'unlimited':
        return null;
    default:
        console.error('Unknown video quality', v);
        return 700000;
    }
}

getSelectElement('sendselect').onchange = async function(e) {
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({send: this.value});
    await reconsiderSendParameters();
};

getSelectElement('simulcastselect').onchange = async function(e) {
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({simulcast: this.value});
    await reconsiderSendParameters();
};

/**
 * Maps the state of the receive UI element to a protocol request.
 *
 * @param {string} what
 * @returns {Record<string,Array<string>>}
 */

function mapRequest(what) {
    switch(what) {
    case '':
        return {'': []};
    case 'audio':
        return {'': ['audio']};
    case 'screenshare':
        return {screenshare: ['audio','video'], '': ['audio']};
    case 'everything-low':
        return {'': ['audio','video-low']};
    case 'everything':
        return {'': ['audio','video']}
    default:
        throw new Error(`Unknown value ${what} in request`);
    }
}

/**
 * Like mapRequest, but for a single label.
 *
 * @param {string} what
 * @param {string} label
 * @returns {Array<string>}
 */

function mapRequestLabel(what, label) {
    let r = mapRequest(what);
    if(label in r)
        return r[label];
    else
        return r[''];
}


getSelectElement('requestselect').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({request: this.value});
    serverConnection.request(mapRequest(this.value));
    reconsiderDownRate();
};

const activityDetectionInterval = 200;
const activityDetectionPeriod = 700;
const activityDetectionThreshold = 0.2;

getInputElement('activitybox').onchange = function(e) {
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({activityDetection: this.checked});
    for(let id in serverConnection.down) {
        let c = serverConnection.down[id];
        if(this.checked)
            c.setStatsInterval(activityDetectionInterval);
        else {
            c.setStatsInterval(0);
            setActive(c, false);
        }
    }
};

getInputElement('displayallbox').onchange = function(e) {
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({displayAll: this.checked});
    for(let id in serverConnection.down) {
        let c = serverConnection.down[id];
        let elt = document.getElementById('peer-' + c.localId);
        showHideMedia(c, elt);
    }
};


/**
 * @this {Stream}
 * @param {Record<string,any>} stats
 */
function gotUpStats(stats) {
    let c = this;

    let values = [];

    for(let id in stats) {
        if(stats[id] && stats[id]['outbound-rtp']) {
            let rate = stats[id]['outbound-rtp'].rate;
            if(typeof rate === 'number') {
                values.push(rate);
            }
        }
    }

    if(values.length === 0) {
        setLabel(c, '');
    } else {
        values.sort((x,y) => x - y);
        setLabel(c, values
                 .map(x => Math.round(x / 1000).toString())
                 .reduce((x, y) => x + '+' + y));
    }
}

/**
 * @param {Stream} c
 * @param {boolean} value
 */
function setActive(c, value) {
    let peer = document.getElementById('peer-' + c.localId);
    if(value)
        peer.classList.add('peer-active');
    else
        peer.classList.remove('peer-active');
}

/**
 * @this {Stream}
 * @param {Record<string,any>} stats
 */
function gotDownStats(stats) {
    if(!getInputElement('activitybox').checked)
        return;

    let c = this;

    let maxEnergy = 0;

    c.pc.getReceivers().forEach(r => {
        let tid = r.track && r.track.id;
        let s = tid && stats[tid];
        let energy = s && s['inbound-rtp'] && s['inbound-rtp'].audioEnergy;
        if(typeof energy === 'number')
            maxEnergy = Math.max(maxEnergy, energy);
    });

    // totalAudioEnergy is defined as the integral of the square of the
    // volume, so square the threshold.
    if(maxEnergy > activityDetectionThreshold * activityDetectionThreshold) {
        c.userdata.lastVoiceActivity = Date.now();
        setActive(c, true);
    } else {
        let last = c.userdata.lastVoiceActivity;
        if(!last || Date.now() - last > activityDetectionPeriod)
            setActive(c, false);
    }
}

/**
 * Add an option to an HTMLSelectElement.
 *
 * @param {HTMLSelectElement} select
 * @param {string} label
 * @param {string} [value]
 */
function addSelectOption(select, label, value) {
    if(!value)
        value = label;
    for(let i = 0; i < select.children.length; i++) {
        let child = select.children[i];
        if(!(child instanceof HTMLOptionElement)) {
            console.warn('Unexpected select child');
            continue;
        }
        if(child.value === value) {
            if(child.label !== label) {
                child.label = label;
            }
            return;
        }
    }

    let option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
}

/**
 * Returns true if an HTMLSelectElement has an option with a given value.
 *
 * @param {HTMLSelectElement} select
 * @param {string} value
 */
function selectOptionAvailable(select, value) {
    let children = select.children;
    for(let i = 0; i < children.length; i++) {
        let child = select.children[i];
        if(!(child instanceof HTMLOptionElement)) {
            console.warn('Unexpected select child');
            continue;
        }
        if(child.value === value)
            return true;
    }
    return false;
}

/**
 * @param {HTMLSelectElement} select
 * @returns {string}
 */
function selectOptionDefault(select) {
    /* First non-empty option. */
    for(let i = 0; i < select.children.length; i++) {
        let child = select.children[i];
        if(!(child instanceof HTMLOptionElement)) {
            console.warn('Unexpected select child');
            continue;
        }
        if(child.value)
            return child.value;
    }
    /* The empty option is always available. */
    return '';
}

/**
  * True if we already went through setMediaChoices twice.
  *
  * @type {boolean}
  */
let mediaChoicesDone = false;

/**
 * Populate the media choices menu.
 *
 * Since media names might not be available before we call
 * getDisplayMedia, we call this function twice, the second time in order
 * to update the menu with user-readable labels.
 *
 * @param{boolean} done
 */
async function setMediaChoices(done) {
    if(mediaChoicesDone)
        return;

    let devices = [];
    try {
        if('mediaDevices' in navigator)
            devices = await navigator.mediaDevices.enumerateDevices();
    } catch(e) {
        console.error(e);
        return;
    }

    let cn = 1, mn = 1;

    devices.forEach(d => {
        let label = d.label;
        if(d.kind === 'videoinput') {
            if(!label)
                label = `Camera ${cn}`;
            addSelectOption(getSelectElement('videoselect'),
                            label, d.deviceId);
            cn++;
        } else if(d.kind === 'audioinput') {
            if(!label)
                label = `Microphone ${mn}`;
            addSelectOption(getSelectElement('audioselect'),
                            label, d.deviceId);
            mn++;
        }
    });

    mediaChoicesDone = done;
}


/**
 * @param {string} [localId]
 */
function newUpStream(localId) {
    if(!serverConnection)
        throw new Error("Not connected");
    let c = serverConnection.newUpStream(localId);
    c.onstatus = function(status) {
        setMediaStatus(c);
    };
    c.onerror = function(e) {
        console.error(e);
        displayError(e);
    };
    return c;
}

/**
 * Sets an up stream's video throughput and simulcast parameters.
 *
 * @param {Stream} c
 * @param {number} bps
 * @param {boolean} simulcast
 */
async function setSendParameters(c, bps, simulcast) {
    if(!c.up)
        throw new Error('Setting throughput of down stream');
    if(c.label === 'screenshare')
        simulcast = false;
    let senders = c.pc.getSenders();
    for(let i = 0; i < senders.length; i++) {
        let s = senders[i];
        if(!s.track || s.track.kind !== 'video')
            continue;
        let p = s.getParameters();
        if((!p.encodings ||
            !simulcast && p.encodings.length !== 1) ||
           (simulcast && p.encodings.length !== 2)) {
            await replaceUpStream(c);
            return;
        }
        p.encodings.forEach(e => {
            if(!e.rid || e.rid === 'h')
                e.maxBitrate = bps || unlimitedRate;
        });
        await s.setParameters(p);
    }
}

let reconsiderParametersTimer = null;

/**
 * Sets the send parameters for all up streams.
 */
async function reconsiderSendParameters() {
    cancelReconsiderParameters();
    let t = getMaxVideoThroughput();
    let s = doSimulcast();
    let promises = [];
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        promises.push(setSendParameters(c, t, s));
    }
    await Promise.all(promises);
}

/**
 * Schedules a call to reconsiderSendParameters after a delay.
 * The delay avoids excessive flapping.
 */
function scheduleReconsiderParameters() {
    cancelReconsiderParameters();
    reconsiderParametersTimer =
        setTimeout(reconsiderSendParameters, 10000 + Math.random() * 10000);
}

function cancelReconsiderParameters() {
    if(reconsiderParametersTimer) {
        clearTimeout(reconsiderParametersTimer);
        reconsiderParametersTimer = null;
    }
}

const unlimitedRate = 1000000000;
const simulcastRate = 100000;
const hqAudioRate = 128000;

/**
 * Decide whether we want to send simulcast.
 *
 * @returns {boolean}
 */
function doSimulcast() {
    switch(getSettings().simulcast) {
    case 'on':
        return true;
    case 'off':
        return false;
    default:
        let count = 0;
        for(let n in serverConnection.users) {
            if(!serverConnection.users[n].permissions["system"]) {
                count++;
                if(count > 2)
                    break;
            }
        }
        if(count <= 2)
            return false;
        let bps = getMaxVideoThroughput();
        return bps <= 0 || bps >= 2 * simulcastRate;
    }
}

/**
 * Sets up c to send the given stream.  Some extra parameters are stored
 * in c.userdata.
 *
 * @param {Stream} c
 * @param {MediaStream} stream
 */

async function setUpStream(c, stream) {
    if(c.stream !== null)
        throw new Error("Setting nonempty stream");

    c.setStream(stream);

    // set up the handler early, in case setFilter fails.
    c.onclose = async replace => {
        await removeFilter(c);
        if(!replace) {
            stopStream(c.stream);
            if(c.userdata.onclose)
                c.userdata.onclose.call(c);
            delMedia(c.localId);
        }
    }

    await setFilter(c);

    /**
     * @param {MediaStreamTrack} t
     */
    function addUpTrack(t) {
        let settings = getSettings();
        if(c.label === 'camera') {
            if(t.kind === 'audio') {
                if(settings.localMute)
                    t.enabled = false;
            } else if(t.kind === 'video') {
                if(settings.blackboardMode) {
                    t.contentHint = 'detail';
                }
            }
        }
        t.onended = e => {
            stream.onaddtrack = null;
            stream.onremovetrack = null;
            c.close();
        };

        let encodings = [];
        let simulcast = c.label !== 'screenshare' && doSimulcast();
        if(t.kind === 'video') {
            let bps = getMaxVideoThroughput();
            // Firefox doesn't like us setting the RID if we're not
            // simulcasting.
            if(simulcast) {
                encodings.push({
                    rid: 'h',
                    maxBitrate: bps || unlimitedRate,
                });
                encodings.push({
                    rid: 'l',
                    scaleResolutionDownBy: 2,
                    maxBitrate: simulcastRate,
                });
            } else {
                encodings.push({
                    maxBitrate: bps || unlimitedRate,
                });
            }
        } else {
            if(settings.hqaudio) {
                encodings.push({
                    maxBitrate: hqAudioRate,
                });
            }
        }
        let tr = c.pc.addTransceiver(t, {
            direction: 'sendonly',
            streams: [stream],
            sendEncodings: encodings,
        });

        // Firefox before 110 does not implement sendEncodings, and
        // requires this hack, which throws an exception on Chromium.
        try {
            let p = tr.sender.getParameters();
            if(!p.encodings) {
                p.encodings = encodings;
                tr.sender.setParameters(p);
            }
        } catch(e) {
        }
    }

    // c.stream might be different from stream if there's a filter
    c.stream.getTracks().forEach(addUpTrack);

    stream.onaddtrack = function(e) {
        addUpTrack(e.track);
    };

    stream.onremovetrack = function(e) {
        let t = e.track;

        /** @type {RTCRtpSender} */
        let sender;
        c.pc.getSenders().forEach(s => {
            if(s.track === t)
                sender = s;
        });
        if(sender) {
            c.pc.removeTrack(sender);
        } else {
            console.warn('Removing unknown track');
        }

        let found = false;
        c.pc.getSenders().forEach(s => {
            if(s.track)
                found = true;
        });
        if(!found) {
            stream.onaddtrack = null;
            stream.onremovetrack = null;
            c.close();
        }
    };

    c.onstats = gotUpStats;
    c.setStatsInterval(2000);
}

/**
 * Replaces c with a freshly created stream, duplicating any relevant
 * parameters in c.userdata.
 *
 * @param {Stream} c
 * @returns {Promise<Stream>}
 */
async function replaceUpStream(c) {
    await removeFilter(c);
    let cn = newUpStream(c.localId);
    cn.label = c.label;
    if(c.userdata.filterDefinition)
        cn.userdata.filterDefinition = c.userdata.filterDefinition;
    if(c.userdata.onclose)
        cn.userdata.onclose = c.userdata.onclose;
    let media = /** @type{HTMLVideoElement} */
        (document.getElementById('media-' + c.localId));
    try {
        await setUpStream(cn, c.stream);
    } catch(e) {
        console.error(e);
        displayError(e);
        cn.close();
        c.close();
        return null;
    }

    await setMedia(cn,
                   cn.label === 'camera' && getSettings().mirrorView,
                   cn.label === 'video' && media);

    return cn;
}

/**
 * Replaces all up streams with the given label.  If label is null,
 * replaces all up stream.
 *
 * @param {string} label
 */
async function replaceUpStreams(label) {
    let promises = [];
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(label && c.label !== label)
            continue
        promises.push(replaceUpStream(c));
    }
    await Promise.all(promises);
}

/**
 * Closes and reopens the camera then replaces the camera stream.
 */
function replaceCameraStream() {
    let c = findUpMedia('camera');
    if(c)
        addLocalMedia(c.localId);
}

/**
 * @param {string} [localId]
 */
async function addLocalMedia(localId) {
    let settings = getSettings();

    /** @type{boolean|MediaTrackConstraints} */
    let audio = settings.audio ? {deviceId: settings.audio} : false;
    /** @type{boolean|MediaTrackConstraints} */
    // Audio-only build: never request the camera, for privacy.
    let video = false;

    if(video) {
        let resolution = settings.resolution;
        if(resolution) {
            video.width = { ideal: resolution[0] };
            video.height = { ideal: resolution[1] };
        } else if(settings.blackboardMode) {
            video.width = { min: 640, ideal: 1920 };
            video.height = { min: 400, ideal: 1080 };
        } else {
            video.aspectRatio = { ideal: 4/3 };
        }
    }

    if(audio) {
        if(!settings.preprocessing) {
            audio.echoCancellation = false;
            audio.noiseSuppression = false;
            audio.autoGainControl = false;
        }
        if(settings.hqaudio)
            audio.channelCount = 2;
    }

    let old = serverConnection.findByLocalId(localId);
    if(old) {
        // make sure that the camera is released before we try to reopen it
        await removeFilter(old);
        stopStream(old.stream);
    }

    let constraints = {audio: audio, video: video};
    /** @type {MediaStream} */
    let stream = null;
    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch(e) {
        displayError(e);
        return;
    }

    setMediaChoices(true);

    // Insert the mic-gain node so its level can be adjusted live.
    stream = applyMicGain(stream);

    let c;

    try {
        c = newUpStream(localId);
    } catch(e) {
        console.log(e);
        displayError(e);
        return;
    }

    c.label = 'camera';
    // Tear the gain graph down when this stream really closes (setUpStream
    // only calls this on a genuine close, not on renegotiation/replace).
    c.userdata.onclose = teardownMicGain;

    if(settings.filter) {
        let filter = filters[settings.filter];
        if(filter)
            c.userdata.filterDefinition = filter;
        else
            displayWarning(`Unknown filter ${settings.filter}`);
    }

    try {
        await setUpStream(c, stream);
        await setMedia(c, settings.mirrorView);
    } catch(e) {
        console.error(e);
        displayError(e);
        c.close();
    }
    setButtonsVisibility();
}

let safariScreenshareDone = false;

async function addShareMedia() {
    if(!safariScreenshareDone) {
        if(isSafari()) {
            let ok = confirm(
                'Screen sharing in Safari is broken.  ' +
                    'It will work at first, ' +
                    'but then your video will randomly freeze.  ' +
                    'Are you sure that you wish to enable screensharing?'
            );
            if(!ok)
                return
        }
        safariScreenshareDone = true;
    }

    /** @type {MediaStream} */
    let stream = null;
    try {
        if(!('getDisplayMedia' in navigator.mediaDevices))
            throw new Error('Your browser does not support screen sharing');
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
        });
    } catch(e) {
        console.error(e);
        displayError(e);
        return;
    }

    let c = newUpStream();
    c.label = 'screenshare';
    await setUpStream(c, stream);
    await setMedia(c);
    setButtonsVisibility();
}

/**
 * @param {File} file
 */
async function addFileMedia(file) {
    let url = URL.createObjectURL(file);
    let video = document.createElement('video');
    video.src = url;
    video.controls = true;
    let stream;
    /** @ts-ignore */
    if(video.captureStream)
        /** @ts-ignore */
        stream = video.captureStream();
    /** @ts-ignore */
    else if(video.mozCaptureStream)
        /** @ts-ignore */
        stream = video.mozCaptureStream();
    else {
        displayError("This browser doesn't support file playback");
        return;
    }

    let c = newUpStream();
    c.label = 'video';
    c.userdata.onclose = function() {
        let media = /** @type{HTMLVideoElement} */
            (document.getElementById('media-' + this.localId));
        if(media && media.src) {
            URL.revokeObjectURL(media.src);
            media.src = null;
        }
    };
    await setUpStream(c, stream);

    let presenting = !!findUpMedia('camera');
    let muted = getSettings().localMute;
    if(presenting && !muted) {
        setLocalMute(true, true);
        displayWarning('You have been muted');
    }

    await setMedia(c, false, video);
    c.userdata.play = true;
    setButtonsVisibility();
}

/**
 * @param {MediaStream} s
 */
function stopStream(s) {
    s.getTracks().forEach(t => {
        try {
            t.stop();
        } catch(e) {
            console.warn(e);
        }
    });
}

/**
 * closeUpMedia closes all up connections with the given label.  If label
 * is null, it closes all up connections.
 *
 * @param {string} [label]
*/
function closeUpMedia(label) {
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(label && c.label !== label)
            continue
        c.close();
    }
}

/**
 * @param {string} label
 * @returns {Stream}
 */
function findUpMedia(label) {
    if(!serverConnection)
        return null;
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(c.label === label)
            return c;
    }
    return null;
}

/**
 * @param {boolean} mute
 */
// Local microphone input gain.  WebRTC has no hardware-gain API, so we
// route the captured mic through a Web Audio GainNode and send the
// processed track.  Module-level singletons: there is only ever one
// local microphone stream.
let micAudioContext = null;
let micGainNode = null;
let micRawStream = null;

/**
 * The stored mic gain as a linear factor (1.0 == 100%).
 * @returns {number}
 */
function micGainValue() {
    let g = getSettings().micGain;
    if(typeof g !== 'number' || !(g >= 0))
        g = 100;
    return g / 100;
}

/**
 * Stop the raw capture and close the audio graph feeding the mic gain
 * node.  Safe to call when nothing is set up.
 */
function teardownMicGain() {
    if(micRawStream) {
        micRawStream.getTracks().forEach(t => t.stop());
        micRawStream = null;
    }
    if(micAudioContext) {
        micAudioContext.close().catch(() => {});
        micAudioContext = null;
    }
    micGainNode = null;
}

/**
 * Route a captured microphone stream through a gain node so its level
 * can be adjusted live.  Returns a stream carrying the processed audio;
 * on any failure it returns the original stream unchanged.
 *
 * @param {MediaStream} stream
 * @returns {MediaStream}
 */
function applyMicGain(stream) {
    if(stream.getAudioTracks().length === 0)
        return stream;
    teardownMicGain();
    try {
        let Ctx = window.AudioContext || window.webkitAudioContext;
        if(!Ctx)
            return stream;
        micAudioContext = new Ctx();
        micAudioContext.resume().catch(() => {});
        micRawStream = stream;
        let source = micAudioContext.createMediaStreamSource(stream);
        micGainNode = micAudioContext.createGain();
        micGainNode.gain.value = micGainValue();
        let dest = micAudioContext.createMediaStreamDestination();
        source.connect(micGainNode);
        micGainNode.connect(dest);
        return dest.stream;
    } catch(e) {
        console.warn("Couldn't set up microphone gain:", e);
        teardownMicGain();
        return stream;
    }
}

/**
 * Set the microphone level (percent), clamped to 10-200 and snapped to
 * 5% steps (10% is the floor since 0% would just duplicate mute).  Keeps
 * the slider, the stored setting, and the live gain node in sync, and
 * returns the value actually applied.
 *
 * @param {number} v
 * @returns {number}
 */
function setMicGain(v) {
    v = Math.max(10, Math.min(200, Math.round(v / 5) * 5));
    let micgain = getInputElement('micgain');
    if(micgain)
        micgain.value = String(v);
    updateSettings({micGain: v});
    if(micGainNode)
        micGainNode.gain.value = v / 100;
    return v;
}

function muteLocalTracks(mute) {
    if(!serverConnection)
        return;
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(c.label === 'camera') {
            let stream = c.stream;
            stream.getTracks().forEach(t => {
                if(t.kind === 'audio') {
                    t.enabled = !mute;
                }
            });
        }
    }
}

/**
 * @param {string} id
 * @param {boolean} force
 * @param {boolean} [value]
 */
function forceDownRate(id, force, value) {
    let c = serverConnection.down[id];
    if(!c)
        throw new Error("Unknown down stream");
    if('requested' in c.userdata) {
        if(force)
            c.userdata.requested.force = !!value;
        else
            delete(c.userdata.requested.force);
    } else {
        if(force)
            c.userdata.requested = {force: value};
    }
    reconsiderDownRate(id);
}

/**
 * Maps 'video' to 'video-low'.  Returns null if nothing changed.
 *
 * @param {string[]} requested
 * @returns {string[]}
 */
function mapVideoToLow(requested) {
    let result = [];
    let found = false;
    for(let i = 0; i < requested.length; i++) {
        let r = requested[i];
        if(r === 'video') {
            r = 'video-low';
            found = true;
        }
        result.push(r);
    }
    if(!found)
        return null;
    return result;
}

/**
 * Reconsider the video track requested for a given down stream.
 *
 * @param {string} [id] - the id of the track to reconsider, all if null.
 */
function reconsiderDownRate(id) {
    if(!serverConnection)
        return;
    if(!id) {
        for(let id in serverConnection.down) {
            reconsiderDownRate(id);
        }
        return;
    }
    let c = serverConnection.down[id];
    if(!c)
        throw new Error("Unknown down stream");
    let normalrequest = mapRequestLabel(getSettings().request, c.label);

    let requestlow = mapVideoToLow(normalrequest);
    if(requestlow === null)
        return;

    let old = c.userdata.requested;
    let low = false;
    if(old && ('force' in old)) {
        low = old.force;
    } else {
        let media = /** @type {HTMLVideoElement} */
            (document.getElementById('media-' + c.localId));
        if(!media)
            throw new Error("No media for stream");
        let w = media.scrollWidth;
        let h = media.scrollHeight;
        if(w && h && w * h <= 320 * 240) {
            low = true;
        }
    }

    if(low !== !!(old && old.low)) {
        if('requested' in c.userdata)
            c.userdata.requested.low = low;
        else
            c.userdata.requested = {low: low};
        c.request(low ? requestlow : null);
    }
}

let reconsiderDownRateTimer = null;

/**
 * Schedules reconsiderDownRate() to be run later.  The delay avoids too
 * much recomputations when resizing the window.
 */
function scheduleReconsiderDownRate() {
    if(reconsiderDownRateTimer)
        return;
    reconsiderDownRateTimer =
        setTimeout(() => {
            reconsiderDownRateTimer = null;
            reconsiderDownRate();
        }, 200);
}

/**
 * setMedia adds a new media element corresponding to stream c.
 *
 * @param {Stream} c
 * @param {boolean} [mirror]
 *     - whether to mirror the video
 * @param {HTMLVideoElement} [video]
 *     - the video element to add.  If null, a new element with custom
 *       controls will be created.
 */
async function setMedia(c, mirror, video) {
    let div = document.getElementById('peer-' + c.localId);
    if(!div) {
        div = document.createElement('div');
        div.id = 'peer-' + c.localId;
        div.classList.add('peer');
        let peersdiv = document.getElementById('peers');
        peersdiv.appendChild(div);
    }

    showHideMedia(c, div)

    let media = /** @type {HTMLVideoElement} */
        (document.getElementById('media-' + c.localId));
    if(!media) {
        if(video) {
            media = video;
        } else {
            media = document.createElement('video');
            if(c.up)
                media.muted = true;
        }

        media.classList.add('media');
        media.autoplay = true;
        media.playsInline = true;
        media.id = 'media-' + c.localId;
        div.appendChild(media);
        addCustomControls(media, div, c, !!video);
    }

    if(mirror)
        media.classList.add('mirror');
    else
        media.classList.remove('mirror');

    if(!video && media.srcObject !== c.stream)
        media.srcObject = c.stream;

    if(!c.up) {
        media.onfullscreenchange = function(e) {
            forceDownRate(c.id, document.fullscreenElement === media, false);
        }
    }

    let label = document.getElementById('label-' + c.localId);
    if(!label) {
        label = document.createElement('div');
        label.id = 'label-' + c.localId;
        label.classList.add('label');
        div.appendChild(label);
    }

    setLabel(c);
    setMediaStatus(c);

    showVideo();
    resizePeers();
}


/**
 * @param {Stream} c
 * @param {HTMLElement} elt
 */
function showHideMedia(c, elt) {
    let display = c.up || getSettings().displayAll;
    if(!display && c.stream) {
        let tracks = c.stream.getTracks();
        for(let i = 0; i < tracks.length; i++) {
            let t = tracks[i];
            if(t.kind === 'video') {
                display = true;
                break;
            }
        }
    }
    if(display)
        elt.classList.remove('peer-hidden');
    else
        elt.classList.add('peer-hidden');
}

/**
 * resetMedia resets the source stream of the media element associated
 * with c.  This has the side-effect of resetting any frozen frames.
 *
 * @param {Stream} c
 */
function resetMedia(c) {
    let media = /** @type {HTMLVideoElement} */
        (document.getElementById('media-' + c.localId));
    if(!media) {
        console.error("Resetting unknown media element")
        return;
    }
    media.srcObject = media.srcObject;
}

/**
 * @param {Element} elt
 */
function cloneHTMLElement(elt) {
    if(!(elt instanceof HTMLElement))
        throw new Error('Unexpected element type');
    return /** @type{HTMLElement} */(elt.cloneNode(true));
}

/**
 * @param {HTMLVideoElement} media
 * @param {HTMLElement} container
 * @param {Stream} c
 * @param {boolean} toponly
 */
function addCustomControls(media, container, c, toponly) {
    if(!toponly && !document.getElementById('controls-' + c.localId)) {
        media.controls = false;

        let template =
            document.getElementById('videocontrols-template').firstElementChild;
        let controls = cloneHTMLElement(template);
        controls.id = 'controls-' + c.localId;

        let volume = getVideoButton(controls, 'volume');

        // The volume slider sets playback level, so it only means anything
        // on a stream you're listening to.  Your own outgoing stream is
        // muted to yourself, so drop the (inert) slider from any up-stream
        // tile, not just the camera.
        if(c.up) {
            volume.remove();
        } else {
            setVolumeButton(media.muted,
                            getVideoButton(controls, "volume-mute"),
                            getVideoButton(controls, "volume-slider"));
        }
        container.appendChild(controls);
    }

    if(c.up && !document.getElementById('topcontrols-' + c.localId)) {
        let toptemplate =
            document.getElementById('topvideocontrols-template').firstElementChild;
        let topcontrols = cloneHTMLElement(toptemplate);
        topcontrols.id = 'topcontrols-' + c.localId;
        container.appendChild(topcontrols);
    }
    registerControlHandlers(c.localId, media, container);
}

/**
 * @param {HTMLElement} container
 * @param {string} name
 */
function getVideoButton(container, name) {
    return /** @type {HTMLElement} */(container.getElementsByClassName(name)[0]);
}

/**
 * @param {boolean} muted
 * @param {HTMLElement} button
 * @param {HTMLElement} slider
 */
function setVolumeButton(muted, button, slider) {
    if(!muted) {
        button.classList.remove("fa-volume-mute");
        button.classList.add("fa-volume-up");
    } else {
        button.classList.remove("fa-volume-up");
        button.classList.add("fa-volume-mute");
    }

    if(!(slider instanceof HTMLInputElement))
        throw new Error("Couldn't find volume slider");
    slider.disabled = muted;
}

/**
 * @param {string} localId
 * @param {HTMLVideoElement} media
 * @param {HTMLElement} container
 */
function registerControlHandlers(localId, media, container) {
    let play = getVideoButton(container, 'video-play');
    if(play) {
        play.onclick = function(event) {
            event.preventDefault();
            media.play();
        };
    }

    let stop = getVideoButton(container, 'video-stop');
    if(stop) {
        stop.onclick = function(event) {
            event.preventDefault();
            try {
                let c = serverConnection.findByLocalId(localId);
                if(!c)
                    throw new Error('Closing unknown stream');
                c.close();
            } catch(e) {
                console.error(e);
                displayError(e);
            }
        };
    }

    let volume = getVideoButton(container, 'volume');
    if (volume) {
        volume.onclick = function(event) {
            let target = /** @type{HTMLElement} */(event.target);
            if(!target.classList.contains('volume-mute'))
                // if click on volume slider, do nothing
                return;
            event.preventDefault();
            media.muted = !media.muted;
            setVolumeButton(media.muted, target,
                            getVideoButton(volume, "volume-slider"));
        };
        volume.oninput = function() {
          let slider = /** @type{HTMLInputElement} */
              (getVideoButton(volume, "volume-slider"));
          media.volume = parseFloat(slider.value)/100;
        };
    }

    let pip = getVideoButton(container, 'pip');
    if(pip) {
        if(HTMLVideoElement.prototype.requestPictureInPicture) {
            pip.onclick = function(e) {
                e.preventDefault();
                if(media.requestPictureInPicture) {
                    media.requestPictureInPicture();
                } else {
                    displayWarning('Picture in Picture not supported.');
                }
            };
        } else {
            pip.style.display = 'none';
        }
    }

    let fs = getVideoButton(container, 'fullscreen');
    if(fs) {
        if(HTMLVideoElement.prototype.requestFullscreen ||
           /** @ts-ignore */
           HTMLVideoElement.prototype.webkitRequestFullscreen) {
            fs.onclick = function(e) {
                e.preventDefault();
                if(media.requestFullscreen) {
                    media.requestFullscreen();
                /** @ts-ignore */
                } else if(media.webkitRequestFullscreen) {
                    /** @ts-ignore */
                    media.webkitRequestFullscreen();
                } else {
                    displayWarning('Full screen not supported!');
                }
            };
        } else {
            fs.style.display = 'none';
        }
    }
}

/**
 * @param {string} localId
 */
function delMedia(localId) {
    let mediadiv = document.getElementById('peers');
    let peer = document.getElementById('peer-' + localId);
    if(!peer)
        throw new Error('Removing unknown media');

    let media = /** @type{HTMLVideoElement} */
        (document.getElementById('media-' + localId));

    media.srcObject = null;
    mediadiv.removeChild(peer);

    setButtonsVisibility();
    resizePeers();
    hideVideo();
}

/**
 * @param {Stream} c
 */
function setMediaStatus(c) {
    let state = c && c.pc && c.pc.iceConnectionState;
    let good = state === 'connected' || state === 'completed';

    let media = document.getElementById('media-' + c.localId);
    if(!media) {
        console.warn('Setting status of unknown media.');
        return;
    }
    if(good) {
        media.classList.remove('media-failed');
        if(c.userdata.play) {
            if(media instanceof HTMLMediaElement)
                media.play().catch(e => {
                    console.error(e);
                    displayError(e);
                });
            delete(c.userdata.play);
        }
    } else {
        media.classList.add('media-failed');
    }

    if(!c.up && state === 'failed') {
        let from = c.username ?
            `from user ${c.username}` :
            'from anonymous user';
        displayWarning(`Cannot receive media ${from}, still trying...`);
    }
}


/**
 * @param {Stream} c
 * @param {string} [fallback]
 */
function setLabel(c, fallback) {
    let label = document.getElementById('label-' + c.localId);
    if(!label)
        return;
    let l = c.username;
    if(l) {
        label.textContent = l;
        label.classList.remove('label-fallback');
    } else if(fallback) {
        label.textContent = fallback;
        label.classList.add('label-fallback');
    } else {
        label.textContent = '';
        label.classList.remove('label-fallback');
    }
}

function resizePeers() {
    // Window resize can call this method too early
    if (!serverConnection)
        return;
    let count =
        Object.keys(serverConnection.up).length +
        Object.keys(serverConnection.down).length;
    let peers = document.getElementById('peers');
    let columns = Math.ceil(Math.sqrt(count));
    if (!count)
        // No video, nothing to resize.
        return;
    let container = document.getElementById("video-container");
    // Peers div has total padding of 40px, we remove 40 on offsetHeight
    // Grid has row-gap of 5px
    let rows = Math.ceil(count / columns);
    let margins = (rows - 1) * 5 + 40;

    if (count <= 2 && container.offsetHeight > container.offsetWidth) {
        peers.style['grid-template-columns'] = "repeat(1, 1fr)";
        rows = count;
    } else {
        peers.style['grid-template-columns'] = `repeat(${columns}, 1fr)`;
    }
    if (count === 1)
        return;
    let max_video_height = (peers.offsetHeight - margins) / rows;
    let media_list = peers.querySelectorAll(".media");
    for(let i = 0; i < media_list.length; i++) {
        let media = media_list[i];
        if(!(media instanceof HTMLMediaElement)) {
            console.warn('Unexpected media');
            continue;
        }
        media.style['max-height'] = max_video_height + "px";
    }
}

/**
 * Lexicographic order, with case differences secondary.
 * @param{string} a
 * @param{string} b
 */
function stringCompare(a, b) {
    let la = a.toLowerCase();
    let lb = b.toLowerCase();
    if(la < lb)
        return -1;
    else if(la > lb)
        return +1;
    else if(a < b)
        return -1;
    else if(a > b)
        return +1;
    return 0
}

/**
 * @param {string} v
 */
function dateFromInput(v) {
    let d = new Date(v);
    if(d.toString() === 'Invalid Date')
        throw new Error('Invalid date');
    return d;
}

/**
 * @param {Date} d
 */
function dateToInput(d) {
    let dd = new Date(d);
    dd.setMinutes(dd.getMinutes() - dd.getTimezoneOffset());
    return dd.toISOString().slice(0, -1);
}

function inviteMenu() {
    let d = /** @type {HTMLDialogElement} */
        (document.getElementById('invite-dialog'));
    if(!('HTMLDialogElement' in window) || !d.showModal) {
        displayError("This browser doesn't support modal dialogs");
        return;
    }
    d.returnValue = '';
    let c = getButtonElement('invite-cancel');
    c.onclick = function(e) { d.close('cancel'); };
    let u = getInputElement('invite-username');
    u.value = '';
    let now = new Date();
    now.setMilliseconds(0);
    now.setSeconds(0);
    let nb = getInputElement('invite-not-before');
    nb.min = dateToInput(now);
    let ex = getInputElement('invite-expires');
    let expires = new Date(now);
    expires.setDate(expires.getDate() + 2);
    ex.min = dateToInput(now);
    ex.value = dateToInput(expires);
    d.showModal();
}

document.getElementById('invite-dialog').onclose = function(e) {
    if(!(this instanceof HTMLDialogElement))
        throw new Error('Unexpected type for this');
    let dialog = /** @type {HTMLDialogElement} */(this);
    if(dialog.returnValue !== 'invite')
        return;
    let u = getInputElement('invite-username');
    let username = u.value.trim() || null;
    let nb = getInputElement('invite-not-before');
    let notBefore = null;
    if(nb.value) {
        try {
            notBefore = dateFromInput(nb.value);
        } catch(e) {
            displayError(`Couldn't parse ${nb.value}: ${e.message}`);
            return;
        }
    }
    let ex = getInputElement('invite-expires');
    let expires = null;
    if(ex.value) {
        try {
            expires = dateFromInput(ex.value);
        } catch(e) {
            displayError(`Couldn't parse ${ex.value}: ${e.message}`);
            return;
        }
    }
    let template = {}
    if(username)
        template.username = username;
    if(notBefore)
        template['not-before'] = notBefore;
    if(expires)
        template.expires = expires;
    makeToken(template);
};

/**
 * @param {HTMLElement} elt
 */
function userMenu(elt, ev) {
    if(!elt.id.startsWith('user-'))
        throw new Error('Unexpected id for user menu');
    let id = elt.id.slice('user-'.length);
    let user = serverConnection.users[id];
    if(!user)
        throw new Error("Couldn't find user")
    let items = [];
    if(id === serverConnection.id) {
        let mydata = serverConnection.users[serverConnection.id].data;
        if(mydata['raisehand'])
            items.push({label: 'Unraise hand', onClick: () => {
                serverConnection.userAction(
                    'setdata', serverConnection.id, {'raisehand': null},
                );
            }});
        else
            items.push({label: 'Raise hand', onClick: () => {
                serverConnection.userAction(
                    'setdata', serverConnection.id, {'raisehand': true},
                );
            }});
        if(serverConnection.version !== "1" &&
           serverConnection.permissions.indexOf('token') >= 0) {
            items.push({label: 'Invite user', onClick: () => {
                inviteMenu();
            }});
        }
        if(serverConnection.permissions.indexOf('present') >= 0 && canFile())
            items.push({label: 'Broadcast file', onClick: presentFile});
        items.push({label: 'Restart media', onClick: renegotiateStreams});
    } else {
        items.push({label: 'Send file', onClick: () => {
            sendFile(id);
        }});
        if(serverConnection.permissions.indexOf('op') >= 0) {
            items.push({type: 'seperator'}); // sic
            if(user.permissions.indexOf('present') >= 0)
                items.push({label: 'Forbid presenting', onClick: () => {
                    serverConnection.userAction('unpresent', id);
                }});
            else
                items.push({label: 'Allow presenting', onClick: () => {
                    serverConnection.userAction('present', id);
                }});
            items.push({label: 'Mute', onClick: () => {
                serverConnection.userMessage('mute', id);
            }});
            items.push({label: 'Kick out', onClick: () => {
                serverConnection.userAction('kick', id);
            }});
            items.push({label: 'Identify', onClick: () => {
                serverConnection.userAction('identify', id);
            }});
        }
    }
    accessibleMenu(items, ev);
}

/**
 * @param {string} id
 * @param {user} userinfo
 */
function addUser(id, userinfo) {
    let div = document.getElementById('users');
    let user = document.createElement('div');
    user.id = 'user-' + id;
    user.classList.add("user-p");
    if(uiIsNative()) {
        // An option in the participants listbox (see setupListbox), which
        // moves real focus between options with a roving tabindex and
        // handles Enter/Space itself.
        user.setAttribute('role', 'option');
        user.setAttribute('aria-haspopup', 'menu');
        user.tabIndex = -1;
    } else {
        user.setAttribute('role', 'button');
        user.tabIndex = 0;
    }
    setUserStatus(id, user, userinfo);
    user.addEventListener('click', function(e) {
        let elt = e.currentTarget;
        if(!elt || !(elt instanceof HTMLElement))
            throw new Error("Couldn't find user div");
        userMenu(elt, e);
    });
    // Web mode's plain buttons need their own Enter/Space; in native the
    // listbox handler covers it (avoid opening the menu twice).
    if(!uiIsNative())
        user.addEventListener('keydown', function(e) {
            if(e.key !== 'Enter' && e.key !== ' ')
                return;
            e.preventDefault();
            let elt = e.currentTarget;
            if(elt instanceof HTMLElement)
                userMenu(elt);
        });

    let us = div.children;

    if(id === serverConnection.id) {
        if(us.length === 0)
            div.appendChild(user);
        else
            div.insertBefore(user, us[0]);
        return;
    }

    if(userinfo.username) {
        for(let i = 0; i < us.length; i++) {
            let child = us[i];
            let childid = child.id.slice('user-'.length);
            if(childid === serverConnection.id)
                continue;
            let childuser = serverConnection.users[childid] || null;
            let childname = (childuser && childuser.username) || null;
            if(!childname || stringCompare(childname, userinfo.username) > 0) {
                div.insertBefore(user, child);
                return;
            }
        }
    }

    div.appendChild(user);
}

 /**
  * @param {string} id
  * @param {user} userinfo
  */
function changeUser(id, userinfo) {
    let elt = document.getElementById('user-' + id);
    if(!elt) {
        console.warn('Unknown user ' + id);
        return;
    }
    setUserStatus(id, elt, userinfo, true);
}

/**
 * @param {string} id
 * @param {HTMLElement} elt
 * @param {user} userinfo
 */
function setUserStatus(id, elt, userinfo, announce) {
    let name = userinfo.username ? userinfo.username : '(anon)';
    let wasRaised = elt.classList.contains('user-status-raisehand');
    let raised = !!userinfo.data.raisehand;

    let microphone=false, camera = false;
    for(let label in userinfo.streams) {
        for(let kind in userinfo.streams[label]) {
            if(kind === 'audio')
                microphone = true;
            else
                camera = true;
        }
    }

    elt.textContent = name;
    let status = [];
    if(raised)
        status.push('hand raised');
    if(microphone)
        status.push('microphone on');
    elt.setAttribute('aria-label',
                     status.length ? `${name}, ${status.join(', ')}` : name);

    if(raised)
        elt.classList.add('user-status-raisehand');
    else
        elt.classList.remove('user-status-raisehand');
    if(camera) {
        elt.classList.remove('user-status-microphone');
        elt.classList.add('user-status-camera');
    } else if(microphone) {
        elt.classList.add('user-status-microphone');
        elt.classList.remove('user-status-camera');
    } else {
        elt.classList.remove('user-status-microphone');
        elt.classList.remove('user-status-camera');
    }

    if(id === serverConnection.id) {
        setRaiseHandButton(raised);
    } else if(announce && raised && !wasRaised) {
        announcePolite(`${name} raised their hand`);
        playEarcon('notify');
    }
}

/**
 * @param {string} id
 */
function delUser(id) {
    let div = document.getElementById('users');
    let user = document.getElementById('user-' + id);
    div.removeChild(user);
}

/**
 * @param {string} id
 * @param {string} kind
 */
function gotUser(id, kind) {
    switch(kind) {
    case 'add':
        addUser(id, serverConnection.users[id]);
        if(usersReady && isOp() && id !== serverConnection.id) {
            let u = serverConnection.users[id];
            let name = (u && u.username) || '(anon)';
            if(getSettings().announceJoinLeave !== false)
                announcePolite(`${name} joined`);
            playEarcon('joined');
        }
        if(Object.keys(serverConnection.users).length === 3)
            reconsiderSendParameters();
        break;
    case 'delete':
        if(usersReady && isOp() && id !== serverConnection.id) {
            let elt = document.getElementById('user-' + id);
            let name = (elt && elt.textContent) || '(anon)';
            if(getSettings().announceJoinLeave !== false)
                announcePolite(`${name} left`);
            playEarcon('left');
        }
        delUser(id);
        if(Object.keys(serverConnection.users).length < 3)
            scheduleReconsiderParameters();
        break;
    case 'change':
        changeUser(id, serverConnection.users[id]);
        break;
    default:
        console.warn('Unknown user kind', kind);
        break;
    }
}

function displayUsername() {
    document.getElementById('userspan').textContent = serverConnection.username;
    let op = serverConnection.permissions.indexOf('op') >= 0;
    let present = serverConnection.permissions.indexOf('present') >= 0;
    let text = '';
    if(op && present)
        text = '(op, presenter)';
    else if(op)
        text = 'operator';
    else if(present)
        text = 'presenter';
    document.getElementById('permspan').textContent = text;
}

let presentRequested = null;

/**
 * @param {string} s
 */
function capitalise(s) {
    if(s.length <= 0)
        return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {string} title
 */
function setTitle(title) {
    function set(title) {
        document.title = title;
        document.getElementById('title').textContent = title;
    }
    if(title)
        set(title);
    else
        set('Galène');
}

/**
 * Under Safari, we request access to the camera at startup in order to
 * enable autoplay.  The camera stream is stored in safariStream.
 *
 * @type {MediaStream}
 */
let safariStream = null;

async function openSafariStream() {
    if(!isSafari())
        return;

    if(!safariStream)
        safariStream = await navigator.mediaDevices.getUserMedia({audio: true})
}

async function closeSafariStream() {
    if(!safariStream)
        return;
    stopStream(safariStream);
    safariStream = null;
}

/**
 * @this {ServerConnection}
 * @param {string} kind
 * @param {string} group
 * @param {Array<string>} perms
 * @param {Record<string,any>} status
 * @param {Record<string,any>} data
 * @param {string} error
 * @param {string} message
 */
async function gotJoined(kind, group, perms, status, data, error, message) {
    let present = presentRequested;
    presentRequested = null;

    switch(kind) {
    case 'fail':
        if(probingState === 'probing' && error === 'need-username') {
            probingState = 'need-username';
            setVisibility('passwordform', false);
        } else if(message === 'not authorised' &&
                  !getVisibility('passwordform')) {
            // The name is registered to an operator, so a password is
            // required.  Reveal the password field and let them try
            // again, rather than showing a bare error to an ordinary
            // attendee who happened to pick a reserved name.
            setVisibility('passwordform', true);
            displayMessage(
                'That name belongs to an operator. Enter the password, then press Connect.'
            );
            // Defer the focus: this handler is about to close the socket
            // and churn the DOM (setButtonsVisibility, async gotClose),
            // and focus() on a just-revealed field won't stick in the
            // middle of that.  Land it once the dust settles.
            setTimeout(() => getInputElement('password').focus(), 0);
        } else {
            token = null;
            displayError('The server said: ' + message);
        }
        closeSafariStream();
        this.close();
        setButtonsVisibility();
        return;
    case 'redirect':
        closeSafariStream();
        this.close();
        token = null;
        document.location.href = message;
        return;
    case 'leave':
        closeSafariStream();
        this.close();
        setButtonsVisibility();
        setChangePassword(null);
        return;
    case 'join':
    case 'change':
        if(probingState === 'probing') {
            probingState = 'success';
            setVisibility('userform', false);
            setVisibility('passwordform', false);
            closeSafariStream();
            this.close();
            setButtonsVisibility();
            return;
        } else {
            token = null;
        }
        // don't discard endPoint and friends
        for(let key in status)
            groupStatus[key] = status[key];
        setTitle((status && status.displayName) || capitalise(group));
        displayUsername();
        setButtonsVisibility();
        setChangePassword(pwAuth && !!groupStatus.canChangePassword &&
                          serverConnection.username
        );
        openSafariStream();
        if(kind === 'change')
            return;
        break;
    default:
        token = null;
        displayError('Unknown join message');
        closeSafariStream();
        this.close();
        return;
    }

    // Operators typically present mixes, so default them to high-quality
    // stereo audio unless the user has explicitly chosen a value.
    if(serverConnection.permissions.indexOf('op') >= 0 &&
       getSettings().hqaudio === undefined) {
        updateSettings({hqaudio: true});
        let box = getInputElement('hqaudiobox');
        if(box)
            box.checked = true;
    }

    let input = /** @type{HTMLTextAreaElement} */
        (document.getElementById('input'));
    input.placeholder = 'Type /help for help';
    setTimeout(() => {input.placeholder = '';}, 8000);
    // Move focus into the meeting on join so screen-reader users land on
    // a useful control rather than the now-hidden login form.  But if we
    // are about to auto-request the microphone, don't grab focus: let the
    // browser's permission prompt take it instead.
    if(!present)
        input.focus();

    // When comparing GUI modes, re-confirm which interface we're in once
    // we reach the room, since the load-time confirmation happened back on
    // the join screen and the fresh room has little to navigate yet.
    if(window.uiModeExplicit)
        setTimeout(() => announcePolite(
            uiIsNative() ? 'Native interface' : 'Web interface'), 800);

    // Suppress join/leave reports until the initial user list settles.
    usersReady = false;
    if(usersReadyTimer)
        clearTimeout(usersReadyTimer);
    usersReadyTimer = setTimeout(() => { usersReady = true; }, 2000);

    if(status.locked)
        displayWarning('This group is locked');

    if(typeof RTCPeerConnection === 'undefined')
        displayWarning("This browser doesn't support WebRTC");
    else
        this.request(mapRequest(getSettings().request));

    if(('mediaDevices' in navigator) &&
       ('getUserMedia' in navigator.mediaDevices) &&
       serverConnection.permissions.indexOf('present') >= 0 &&
       !findUpMedia('camera')) {
        if(present) {
            if(present === 'mike')
                updateSettings({video: ''});
            else if(present === 'both')
                delSetting('video');
            reflectSettings();

            let button = getButtonElement('presentbutton');
            button.disabled = true;
            try {
                await addLocalMedia();
            } finally {
                button.disabled = false;
            }
        } else {
            displayMessage(
                "Press the Enable button to use your microphone; your browser will ask for permission."
            );
        }
    }
}

/**
 * @param {TransferredFile} f
 */
function gotFileTransfer(f) {
    f.onevent = gotFileTransferEvent;
    let p = document.createElement('p');
    if(f.up)
        p.textContent =
        `We have offered to send a file called "${f.name}" ` +
        `to user ${f.username}.`;
    else
        p.textContent =
        `User ${f.username} offered to send us a file ` +
        `called "${f.name}" of size ${f.size}.`
    let bno = null, byes = null;
    if(!f.up) {
        byes = document.createElement('button');
        byes.textContent = 'Accept';
        byes.onclick = function(e) {
            f.receive();
        };
        byes.id = "byes-" + f.fullid();
    }
    bno = document.createElement('button');
    bno.textContent = f.up ? 'Cancel' : 'Reject';
    bno.onclick = function(e) {
        f.cancel();
    };
    bno.id = "bno-" + f.fullid();
    let status = document.createElement('span');
    status.id = 'status-' + f.fullid();
    if(!f.up) {
        status.textContent =
            '(Choosing "Accept" will disclose your IP address.)';
    }
    let statusp = document.createElement('p');
    statusp.id = 'statusp-' + f.fullid();
    statusp.appendChild(status);
    let div = document.createElement('div');
    div.id = 'file-' + f.fullid();
    div.appendChild(p);
    if(byes)
        div.appendChild(byes);
    if(bno)
        div.appendChild(bno);
    div.appendChild(statusp);
    div.classList.add('message');
    div.classList.add('message-private');
    div.classList.add('message-row');
    let box = document.getElementById('box');
    box.appendChild(div);
    return div;
}

/**
 * @param {TransferredFile} f
 * @param {string} status
 * @param {number} [value]
 */
function setFileStatus(f, status, value) {
    let statuselt = document.getElementById('status-' + f.fullid());
    if(!statuselt)
        throw new Error("Couldn't find statusp");
    statuselt.textContent = status;
    if(value) {
        let progress = document.getElementById('progress-' + f.fullid());
         if(!progress || !(progress instanceof HTMLProgressElement))
            throw new Error("Couldn't find progress element");
        progress.value = value;
        let label = document.getElementById('progresstext-' + f.fullid());
        let percent = Math.round(100 * value / progress.max);
        label.textContent = `${percent}%`;
    }
}

/**
 * @param {TransferredFile} f
 * @param {number} [max]
 */
function createFileProgress(f, max) {
    let statusp = document.getElementById('statusp-' + f.fullid());
    if(!statusp)
        throw new Error("Couldn't find status div");
    /** @type HTMLProgressElement */
    let progress = document.createElement('progress');
    progress.id = 'progress-' + f.fullid();
    progress.classList.add('file-progress');
    progress.max = max;
    progress.value = 0;
    statusp.appendChild(progress);
    let progresstext = document.createElement('span');
    progresstext.id = 'progresstext-' + f.fullid();
    progresstext.textContent = '0%';
    statusp.appendChild(progresstext);
}

/**
 * @param {TransferredFile} f
 * @param {boolean} delyes
 * @param {boolean} delno
 * @param {boolean} [delprogress]
 */
function delFileStatusButtons(f, delyes, delno, delprogress) {
    let div = document.getElementById('file-' + f.fullid());
    if(!div)
        throw new Error("Couldn't find file div");
    if(delyes) {
        let byes = document.getElementById('byes-' + f.fullid())
        if(byes)
            div.removeChild(byes);
    }
    if(delno) {
        let bno = document.getElementById('bno-' + f.fullid())
        if(bno)
            div.removeChild(bno);
    }
    if(delprogress) {
        let statusp = document.getElementById('statusp-' + f.fullid());
        let progress = document.getElementById('progress-' + f.fullid());
        let progresstext =
            document.getElementById('progresstext-' + f.fullid());
        if(progress)
            statusp.removeChild(progress);
        if(progresstext)
            statusp.removeChild(progresstext);
    }
}

/**
 * @this {TransferredFile}
 * @param {string} state
 * @param {any} [data]
 */
function gotFileTransferEvent(state, data) {
    let f = this;
    switch(state) {
    case 'inviting':
        break;
    case 'connecting':
        delFileStatusButtons(f, true, false);
        setFileStatus(f, 'Connecting...');
        createFileProgress(f, f.size);
        break;
    case 'connected':
        setFileStatus(f, f.up ? 'Sending...' : 'Receiving...', f.datalen);
        break;
    case 'done':
        delFileStatusButtons(f, true, true, true);
        setFileStatus(f, 'Done.');
        if(!f.up) {
            let url = URL.createObjectURL(data);
            let a = document.createElement('a');
            a.href = url;
            a.textContent = f.name;
            a.download = f.name;
            a.type = f.mimetype;
            a.click();
            URL.revokeObjectURL(url);
        }
        break;
    case 'cancelled':
        delFileStatusButtons(f, true, true, true);
        if(data)
            setFileStatus(f, `Cancelled: ${data.toString()}.`);
        else
            setFileStatus(f, 'Cancelled.');
        break;
    case 'closed':
        break;
    default:
        console.error(`Unexpected state "${state}"`);
        f.cancel(`unexpected state "${state}" (this shouldn't happen)`);
        break;
    }
}

/**
 * @param {string} id
 * @param {string} dest
 * @param {string} username
 * @param {Date} time
 * @param {boolean} privileged
 * @param {string} kind
 * @param {string} error
 * @param {any} message
 */
function gotUserMessage(id, dest, username, time, privileged, kind, error, message) {
    switch(kind) {
    case 'kicked':
    case 'error':
    case 'warning':
    case 'info': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        let from = id ? (username || 'Anonymous') : 'The Server';
        displayError(`${from} said: ${message}`, kind);
        break;
    }
    case 'mute': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        setLocalMute(true, true);
        let by = username ? ' by ' + username : '';
        displayWarning(`You have been muted${by}`);
        break;
    }
    case 'clearchat': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        let id = message && message.id;
        let userId = message && message.userId;
        clearChat(id, userId);
        break;
    }
    case 'token': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        if(error) {
            displayError(`Token operation failed: ${message}`)
            return
        }
        if(typeof message !== 'object') {
            displayError('Unexpected type for token');
            return;
        }
        let f = formatToken(message, false);
        localMessage(f[0] + ': ' + f[1]);
        if('share' in navigator) {
            try {
                navigator.share({
                    title: `Invitation to Galene group ${message.group}`,
                    text: f[0],
                    url: f[1],
                });
            } catch(e) {
                console.warn("Share failed", e);
            }
        }
        break;
    }
    case 'tokenlist': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        if(error) {
            displayError(`Token operation failed: ${message}`)
            return
        }
        let s = '';
        for(let i = 0; i < message.length; i++) {
            let f = formatToken(message[i], true);
            s = s + f[0] + ': ' + f[1] + "\n";
        }
        localMessage(s);
        break;
    }
    case 'userinfo': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        let u = message.username ?
            'username ' + message.username :
            'unknown username';
        let a = message.address ?
            'address ' + message.address :
            'unknown address';
        localMessage(`User ${message.id} has ${u} and ${a}.`);
        break;
    }
    default:
        console.warn(`Got unknown user message ${kind}`);
        break;
    }
};

/**
 * @param {Object} token
 * @param {boolean} [details]
 */
function formatToken(token, details) {
    let url = new URL(window.location.href);
    let params = new URLSearchParams();
    params.append('token', token.token);
    url.search = params.toString();
    let foruser = '', by = '', togroup = '';
    if(token.username)
        foruser = ` for user ${token.username}`;
    if(details) {
        if(token.issuedBy)
            by = ' issued by ' + token.issuedBy;
        if(token.issuedAt) {
            if(by === '')
                by = ' issued at ' + (new Date(token.issuedAt)).toLocaleString();
            else
                by = by + ' at ' + (new Date(token.issuedAt)).toLocaleString();
        }
    } else {
        if(token.group)
            togroup = ' to group ' + token.group;
    }
    let since = '';
    if(token["not-before"])
        since = ` since ${(new Date(token['not-before'])).toLocaleString()}`
    /** @type{Date} */
    let expires = null;
    let until = '';
    if(token.expires) {
        expires = new Date(token.expires)
        until = ` until ${expires.toLocaleString()}`;
    }
    return [
        (expires && (expires >= new Date())) ?
            `Invitation${foruser}${togroup}${by} valid${since}${until}` :
            `Expired invitation${foruser}${togroup}${by}`,
        url.toString(),
    ];
}

const urlRegexp = /https?:\/\/[-a-zA-Z0-9@:%/._\\+~#&()=?]+[-a-zA-Z0-9@:%/_\\+~#&()=]/g;

/**
 * @param {string} text
 * @returns {HTMLDivElement}
 */
function formatText(text) {
    let r = new RegExp(urlRegexp);
    let result = [];
    let pos = 0;
    while(true) {
        let m = r.exec(text);
        if(!m)
            break;
        result.push(document.createTextNode(text.slice(pos, m.index)));
        let a = document.createElement('a');
        a.href = m[0];
        a.textContent = m[0];
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        result.push(a);
        pos = m.index + m[0].length;
    }
    result.push(document.createTextNode(text.slice(pos)));

    let div = document.createElement('div');
    result.forEach(e => {
        div.appendChild(e);
    });
    return div;
}

/**
 * @param {Date} time
 * @returns {string}
 */
function formatTime(time) {
    let delta = Date.now() - time.getTime();
    let m = time.getMinutes();
    if(delta > -30000)
        return time.getHours() + ':' + ((m < 10) ? '0' : '') + m;
    return time.toLocaleString();
}

/**
 * A short relative time, e.g. "just now", "3 minutes ago".
 * @param {Date} time
 * @returns {string}
 */
function relativeTime(time) {
    let s = Math.floor((Date.now() - time.getTime()) / 1000);
    if(s < 60)
        return 'just now';
    let m = Math.floor(s / 60);
    if(m < 60)
        return `${m} minute${m === 1 ? '' : 's'} ago`;
    let h = Math.floor(m / 60);
    if(h < 24)
        return `${h} hour${h === 1 ? '' : 's'} ago`;
    let d = Math.floor(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
}

// Zero-width / format characters that trailing-whitespace trimming must also
// strip (ZWSP..ZWJ, word joiner, BOM); built from code points so the source
// stays plain ASCII.
const trailingBlank = new RegExp(
    '[\\s' + [0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF]
        .map(c => String.fromCharCode(c)).join('') + ']+$', 'u');

/**
 * Give a message body a clean reading tail: trim trailing whitespace and
 * zero-width characters from its last text node, and, if it doesn't already
 * end in punctuation, append a period.  The period lands inside the same text
 * node (not an isolated node), so a screen reader treats it as a sentence
 * pause before the timestamp rather than speaking the word "dot".
 * @param {HTMLElement} el
 */
function appendReadingPause(el) {
    let last = el.lastChild;
    // Only when the message ends in text (not a link); 3 = TEXT_NODE.
    if(!last || last.nodeType !== 3)
        return;
    let s = last.nodeValue.replace(trailingBlank, '');
    if(!s)
        return;
    if(!/[.!?,:;)\]}]$/u.test(s))
        s += '.';
    last.nodeValue = s;
}

// Keep relative times fresh: the visible header time and the screen-reader
// -only time suffix on each message.
function refreshChatTimes() {
    let box = document.getElementById('box');
    if(!box)
        return;
    // Update in place (characterData) so it doesn't count as a node addition
    // the live region would announce.
    function setText(el, s) {
        if(el.firstChild && el.firstChild.nodeType === 3)
            el.firstChild.nodeValue = s;
        else
            el.textContent = s;
    }
    for(let tm of box.querySelectorAll('.message-time[data-time]')) {
        let t = /** @type{HTMLElement} */(tm);
        // The web-mode timestamp keeps a trailing period (set when created);
        // the native header time does not.
        let s = relativeTime(new Date(Number(t.dataset.time)));
        setText(t, t.classList.contains('message-timestamp') ? s + '.' : s);
    }
    for(let st of box.querySelectorAll('.sr-time[data-time]')) {
        let e = /** @type{HTMLElement} */(st);
        setText(e, ' ' + relativeTime(new Date(Number(e.dataset.time))) + '.');
    }
}
setInterval(refreshChatTimes, 60000);

/**
 * @typedef {Object} lastMessage
 * @property {string} [nick]
 * @property {string} [peerId]
 * @property {string} [dest]
 * @property {Date} [time]
 */

/** @type {lastMessage} */
let lastMessage = {};

/**
 * @param {string} id
 * @param {string} peerId
 * @param {string} dest
 * @param {string} nick
 * @param {Date} time
 * @param {boolean} privileged
 * @param {boolean} history
 * @param {string} kind
 * @param {string|HTMLElement} message
 */
function addToChatbox(id, peerId, dest, nick, time, privileged, history, kind, message) {
    if(kind === 'caption') {
        displayCaption(message);
        return;
    }

    let native = uiIsNative();
    let row = document.createElement('div');
    row.classList.add('message-row');
    // Id lets the chat widget point aria-activedescendant at this message.
    row.id = 'msg-' + (++chatMsgSeq);
    // Native mode: an option in the chat listbox — real focus moves onto it
    // (see setupListbox) so the reader's navigator lands on the message and
    // its text is reviewable by object navigation; its name comes from its
    // own content (no aria-label leaf).  Web mode (prototype): a plain list
    // item, so it stays readable inline in browse mode.
    row.setAttribute('role', native ? 'option' : 'listitem');
    let container = document.createElement('div');
    container.classList.add('message');
    row.appendChild(container);
    let footer = document.createElement('p');
    footer.classList.add('message-footer');
    if(!peerId)
        container.classList.add('message-system');
    if(serverConnection && peerId === serverConnection.id)
        container.classList.add('message-sender');
    if(dest)
        container.classList.add('message-private');

    if(id)
        container.dataset.id = id;
    if(peerId) {
        container.dataset.peerId = peerId;
        container.dataset.username = nick;
        // No per-message click handler: that makes a screen reader announce
        // every message as "clickable" and treat it as one interactive
        // object instead of browsable text.  The operator double-click menu
        // is handled by a single delegated listener on the list (see the
        // chat setup).
    }

    // Screen-reader reading is built from real text (no aria-label), so the
    // body and its links stay walkable by the review cursor.  Native mode
    // wraps it in sr-only "Name:"/time spans (read as one phrase in the
    // listbox); web mode uses the visible sender heading + timestamp below.
    let destName = dest && serverConnection.users[dest] &&
        serverConnection.users[dest].username;
    let sender;
    if(!peerId)
        sender = '';
    else if(kind === 'me')
        sender = nick || '(anon)';
    else if(dest)
        sender = `${nick || '(anon)'} to ${destName || '(anon)'}`;
    else
        sender = nick || '(anon)';
    /** @type{HTMLElement} */
    let body;
    if(message instanceof HTMLElement) {
        body = message;
    } else if(typeof message === 'string') {
        body = formatText(message);
        // Trim and add a sentence-ending period so the reader pauses between
        // the message and the timestamp/position that follow it.
        appendReadingPause(body);
    } else {
        throw new Error('Cannot add element to chatbox');
    }

    // For a live message, anchor the displayed relative time on local
    // receipt so it reads "just now" regardless of client/server clock
    // skew; replayed history keeps its real server timestamp.  (Grouping
    // still uses the server time below.)
    let displayTime = (!history && time) ? new Date() : time;
    // Screen-reader-only time suffix, refreshed by refreshChatTimes.
    function srTimeSpan(t) {
        let st = document.createElement('span');
        st.className = 'sr-only sr-time';
        st.dataset.time = String(t.getTime());
        // Trailing period separates the time from the "N of M" position the
        // listbox speaks after it, so it is easy to tune out.
        st.textContent = ` ${relativeTime(t)}.`;
        return st;
    }

    if(kind !== 'me') {
        let doHeader = true;
        if(lastMessage.nick !== (nick || null) ||
           lastMessage.peerId !== (peerId || null) ||
           lastMessage.dest !== (dest || null) ||
           !time || !lastMessage.time) {
            doHeader = true;
        } else {
            let delta = time.getTime() - lastMessage.time.getTime();
            doHeader = delta < 0 || delta > 60000;
        }

        if(doHeader && native) {
            // Native only: a visual, aria-hidden header; the reading comes
            // from the sr-only name/time spans plus the message body below.
            // (Web mode uses a real sender heading + timestamp instead.)
            let header = document.createElement('p');
            header.setAttribute('aria-hidden', 'true');
            let user = document.createElement('span');
            let u = dest && serverConnection.users[dest];
            let name = (u && u.username);
            user.textContent = dest ?
                `${nick || '(anon)'} \u2192 ${name || '(anon)'}` :
                (nick || '(anon)');
            user.classList.add('message-user');
            header.appendChild(user);
            header.classList.add('message-header');
            container.appendChild(header);
            if(time) {
                let tm = document.createElement('span');
                tm.textContent = relativeTime(displayTime);
                tm.dataset.time = String(displayTime.getTime());
                tm.classList.add('message-time');
                header.appendChild(tm);
            }
        }

        if(native) {
            if(sender) {
                let srName = document.createElement('span');
                srName.className = 'sr-only';
                srName.textContent = `${sender}: `;
                container.appendChild(srName);
            }
            let p = document.createElement('p');
            p.appendChild(body);
            p.classList.add('message-content');
            container.appendChild(p);
            if(displayTime)
                container.appendChild(srTimeSpan(displayTime));
        } else {
            // Web prototype: read from visible, DOM-ordered parts (sender
            // heading, body, timestamp) — no sr-only duplication, no
            // aria-label.  The sender is a heading so browse-mode users can
            // jump message-to-message with the H quick-nav key; consecutive
            // messages from the same sender omit it (see doHeader).  Visual
            // reordering, if ever wanted, belongs in CSS, not the DOM.
            if(doHeader && sender) {
                let h = document.createElement('h3');
                h.className = 'message-sender';
                h.textContent = `${sender}:`;
                container.appendChild(h);
            }
            let p = document.createElement('p');
            p.appendChild(body);
            p.classList.add('message-content', 'message-body');
            container.appendChild(p);
            if(displayTime) {
                let tm = document.createElement('span');
                // message-time is refreshed in place by refreshChatTimes.  The
                // trailing period separates the time from the "N of M" position
                // NVDA speaks after it in focus mode, so it is easy to tune out.
                tm.className = 'message-time message-timestamp';
                tm.dataset.time = String(displayTime.getTime());
                tm.textContent = relativeTime(displayTime) + '.';
                container.appendChild(tm);
            }
        }
        lastMessage.nick = (nick || null);
        lastMessage.peerId = peerId;
        lastMessage.dest = (dest || null);
        lastMessage.time = (time || null);
    } else {
        let asterisk = document.createElement('span');
        asterisk.textContent = '*';
        asterisk.classList.add('message-me-asterisk');
        let user = document.createElement('span');
        user.textContent = nick || '(anon)';
        user.classList.add('message-me-user');
        body.classList.add('message-me-content');
        asterisk.setAttribute('aria-hidden', 'true');
        container.appendChild(asterisk);
        container.appendChild(user);
        container.appendChild(body);
        if(displayTime)
            container.appendChild(srTimeSpan(displayTime));
        container.classList.add('message-me');
        lastMessage = {};
    }
    container.appendChild(footer);

    let box = document.getElementById('box');
    // Your own message would otherwise be read back in full by the chat's
    // live region.  Suppress that around the insert and just say "Sent".
    // Others' messages and replayed history announce normally.
    let ownLive = !history && peerId && serverConnection &&
        peerId === serverConnection.id;
    if(ownLive)
        box.setAttribute('aria-live', 'off');
    box.appendChild(row);
    if(box.scrollHeight > box.clientHeight) {
        box.scrollTop = box.scrollHeight - box.clientHeight;
    }
    if(ownLive) {
        announcePolite('Sent');
        setTimeout(() => box.setAttribute('aria-live', 'polite'), 200);
    }

    return;
}

/**
 * @param {HTMLElement} elt
 * @param {MouseEvent} [ev]
 */
function chatMessageMenu(elt, ev) {
    if(!(serverConnection && serverConnection.permissions &&
         serverConnection.permissions.indexOf('op') >= 0))
        return;

    let messageId = elt.dataset.id;
    let peerId = elt.dataset.peerId;
    if(!peerId)
        return;
    let username = elt.dataset.username;
    let u = username || 'user';

    let items = [];
    if(messageId)
        items.push({label: 'Delete message', onClick: () => {
            serverConnection.groupAction('clearchat', {
                id: messageId,
                userId: peerId,
            });
        }});
    items.push({label: `Delete all from ${u}`,
                onClick: () => {
                    serverConnection.groupAction('clearchat', {
                        userId: peerId,
                    });
                }});
    items.push({label: `Identify ${u}`, onClick: () => {
        serverConnection.userAction('identify', peerId);
    }});
    items.push({label: `Kick out ${u}`, onClick: () => {
        serverConnection.userAction('kick', peerId);
    }});

    accessibleMenu(items, ev);
}

/**
 * @param {string|HTMLElement} message
 */
function setCaption(message) {
    let container = document.getElementById('captions-container');
    let captions = document.getElementById('captions');
    if(!message) {
        captions.replaceChildren();
        container.classList.add('invisible');
    } else {
        if(message instanceof HTMLElement)
            captions.replaceChildren(message);
        else
            captions.textContent = message;
        container.classList.remove('invisible');
    }
}

let captionsTimer = null;

/**
 * @param {string|HTMLElement} message
 */
function displayCaption(message) {
    if(captionsTimer !== null) {
        clearTimeout(captionsTimer);
        captionsTimer = null;
    }
    setCaption(message);
    captionsTimer = setTimeout(() => setCaption(null), 3000);
}

/**
 * @param {string|HTMLElement} message
 */
function localMessage(message) {
    return addToChatbox(null, null, null, null, new Date(), false, false, '', message);
}

/**
 * @param {string} [id]
 * @param {string} [userId]
 */
function clearChat(id, userId) {
    lastMessage = {};

    let box = document.getElementById('box');
    if(!id && !userId) {
        box.textContent = '';
        return;
    }

    let elts = box.children;
    let i = 0;
    while(i < elts.length) {
        let row = elts.item(i);
        if(row instanceof HTMLDivElement) {
            let div = row.firstChild;
            if(div instanceof HTMLDivElement)
                if((!id || div.dataset.id === id) &&
                   div.dataset.peerId === userId) {
                    box.removeChild(row);
                    continue;
                }
        }
        i++;
    }
}

/**
 * A command known to the command-line parser.
 *
 * @typedef {Object} command
 * @property {string} [parameters]
 *     - A user-readable list of parameters.
 * @property {string} [description]
 *     - A user-readable description, null if undocumented.
 * @property {() => string} [predicate]
 *     - Returns null if the command is available.
 * @property {(c: string, r: string) => void} f
 */

/**
 * The set of commands known to the command-line parser.
 *
 * @type {Object.<string,command>}
 */
let commands = {};

function operatorPredicate() {
    if(serverConnection && serverConnection.permissions &&
       serverConnection.permissions.indexOf('op') >= 0)
        return null;
    return 'You are not an operator';
}

function recordingPredicate() {
    if(serverConnection && serverConnection.permissions &&
       serverConnection.permissions.indexOf('record') >= 0)
        return null;
    return 'You are not allowed to record';
}

commands.help = {
    description: 'display this help',
    f: (c, r) => {
        /** @type {string[]} */
        let cs = [];
        for(let cmd in commands) {
            let c = commands[cmd];
            if(!c.description)
                continue;
            if(c.predicate && c.predicate())
                continue;
            cs.push(`/${cmd}${c.parameters?' ' + c.parameters:''}: ${c.description}`);
        }
        localMessage(cs.sort().join('\n'));
    }
};

commands.me = {
    f: (c, r) => {
        // handled as a special case
        throw new Error("this shouldn't happen");
    }
};

commands.set = {
    f: (c, r) => {
        if(!r) {
            let settings = getSettings();
            let s = "";
            for(let key in settings)
                s = s + `${key}: ${JSON.stringify(settings[key])}\n`;
            localMessage(s);
            return;
        }
        let p = parseCommand(r);
        let value;
        if(p[1]) {
            value = JSON.parse(p[1]);
        } else {
            value = true;
        }
        updateSetting(p[0], value);
        reflectSettings();
    }
};

commands.unset = {
    f: (c, r) => {
        delSetting(r.trim());
        return;
    }
};

commands.leave = {
    description: "leave group",
    f: (c, r) => {
        if(!serverConnection)
            throw new Error('Not connected');
        serverConnection.close();
    }
};

commands.clear = {
    predicate: operatorPredicate,
    description: 'clear the chat history',
    f: (c, r) => {
        serverConnection.groupAction('clearchat');
    }
};

commands.lock = {
    predicate: operatorPredicate,
    description: 'lock this group',
    parameters: '[message]',
    f: (c, r) => {
        serverConnection.groupAction('lock', r);
    }
};

commands.unlock = {
    predicate: operatorPredicate,
    description: 'unlock this group, revert the effect of /lock',
    f: (c, r) => {
        serverConnection.groupAction('unlock');
    }
};

commands.record = {
    predicate: recordingPredicate,
    description: 'start recording',
    f: (c, r) => {
        serverConnection.groupAction('record');
    }
};

commands.unrecord = {
    predicate: recordingPredicate,
    description: 'stop recording',
    f: (c, r) => {
        serverConnection.groupAction('unrecord');
    }
};

commands.subgroups = {
    predicate: operatorPredicate,
    description: 'list subgroups',
    f: (c, r) => {
        serverConnection.groupAction('subgroups');
    }
};

/**
 * @type {Record<string,number>}
 */
const units = {
    s: 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    mon: 31 * 24 * 60 * 60 * 1000,
    yr: 365 * 24 * 60 * 60 * 1000,
};

/**
 * @param {string} s
 * @returns {Date|number}
 */
function parseExpiration(s) {
    if(!s)
        return null;
    let re = /^([0-9]+)(s|min|h|d|mon|yr)$/
    let e = re.exec(s)
    if(e) {
        let unit = units[e[2]];
        if(!unit)
            throw new Error(`Couldn't find unit ${e[2]}`);
        return parseInt(e[1]) * unit;
    }
    let d = new Date(s);
    if(d.toString() === 'Invalid Date')
        throw new Error("Couldn't parse expiration date");
    return d;
}

function makeTokenPredicate() {
    return (serverConnection.permissions.indexOf('token') < 0 ?
            "You don't have permission to create tokens" : null);
}

function editTokenPredicate() {
    return (serverConnection.permissions.indexOf('token') < 0 ||
            serverConnection.permissions.indexOf('op') < 0 ?
            "You don't have permission to edit or list tokens" : null);
}

/**
 * @param {Object} [template]
 */
function makeToken(template) {
    if(!template)
        template = {};
    let v = {
        group: group,
    }
    if('username' in template)
        v.username = template.username;
    if('expires' in template)
        v.expires = template.expires;
    else
        v.expires = units.d;
    if('not-before' in template)
        v["not-before"] = template["not-before"];
    if('permissions' in template)
        v.permissions = template.permissions;
    else {
        v.permissions = [];
        if(serverConnection.permissions.indexOf('present') >= 0)
            v.permissions.push('present');
        if(serverConnection.permissions.indexOf('message') >= 0)
            v.permissions.push('message');
    }
    serverConnection.groupAction('maketoken', v);
}

commands.invite = {
    predicate: makeTokenPredicate,
    description: "create an invitation link",
    parameters: "[username] [expiration]",
    f: (c, r) => {
        let p = parseCommand(r);
        let template = {};
        if(p[0])
            template.username = p[0];
        let expires = parseExpiration(p[1]);
        if(expires)
            template.expires = expires;
        makeToken(template);
    }
}

/**
 * @param {string} t
 */
function parseToken(t) {
    let m = /^https?:\/\/.*?token=([^?]+)/.exec(t);
    if(m) {
        return m[1];
    } else if(!/^https?:\/\//.exec(t)) {
        return t
    } else {
        throw new Error("Couldn't parse link");
    }
}

commands.reinvite = {
    predicate: editTokenPredicate,
    description: "extend an invitation link",
    parameters: "link [expiration]",
    f: (c, r) => {
        let p = parseCommand(r);
        let v = {}
        v.token = parseToken(p[0]);
        if(p[1])
            v.expires = parseExpiration(p[1]);
        else
            v.expires = units.d;
        serverConnection.groupAction('edittoken', v);
    }
}

commands.revoke = {
    predicate: editTokenPredicate,
    description: "revoke an invitation link",
    parameters: "link",
    f: (c, r) => {
        let token = parseToken(r);
        serverConnection.groupAction('edittoken', {
            token: token,
            expires: -units.s,
        });
    }
}

commands.listtokens = {
    predicate: editTokenPredicate,
    description: "list invitation links",
    f: (c, r) => {
        serverConnection.groupAction('listtokens');
    }
}

function renegotiateStreams() {
    for(let id in serverConnection.up)
        serverConnection.up[id].restartIce();
    for(let id in serverConnection.down)
        serverConnection.down[id].restartIce();
}

commands.renegotiate = {
    description: 'renegotiate media streams',
    f: (c, r) => {
        renegotiateStreams();
    }
};

commands.replace = {
    f: (c, r) => {
        replaceUpStreams(null);
    }
};

commands.sharescreen = {
    description: 'start a screen share',
    f: (c, r) => {
        addShareMedia();
    }
}

commands.unsharescreen = {
    description: 'stop screen share',
    f: (c, r) => {
        closeUpMedia('screenshare');
    }
}

/**
 * parseCommand splits a string into two space-separated parts.  The first
 * part may be quoted and may include backslash escapes.
 *
 * @param {string} line
 * @returns {string[]}
 */
function parseCommand(line) {
    let i = 0;
    while(i < line.length && line[i] === ' ')
        i++;
    let start = ' ';
    if(i < line.length && (line[i] === '"' || line[i] === "'")) {
        start = line[i];
        i++;
    }
    let first = "";
    while(i < line.length) {
        if(line[i] === start) {
            if(start !== ' ')
                i++;
            break;
        }
        if(line[i] === '\\' && i < line.length - 1)
            i++;
        first = first + line[i];
        i++;
    }

    while(i < line.length && line[i] === ' ')
        i++;
    return [first, line.slice(i)];
}

/**
 * @param {string} user
 */
function findUserId(user) {
    if(user in serverConnection.users)
        return user;

    for(let id in serverConnection.users) {
        let u = serverConnection.users[id];
        if(u && u.username === user)
            return id;
    }
    return null;
}

/**
   @param {string} c
   @param {string} r
*/
function userCommand(c, r) {
    let p = parseCommand(r);
    if(!p[0])
        throw new Error(`/${c} requires parameters`);
    let id = findUserId(p[0]);
    if(!id)
        throw new Error(`Unknown user ${p[0]}`);
    serverConnection.userAction(c, id, p[1]);
}

function userMessage(c, r) {
    let p = parseCommand(r);
    if(!p[0])
        throw new Error(`/${c} requires parameters`);
    let id = findUserId(p[0]);
    if(!id)
        throw new Error(`Unknown user ${p[0]}`);
    serverConnection.userMessage(c, id, p[1]);
}

commands.kick = {
    parameters: 'user [message]',
    description: 'kick out a user',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.identify = {
    parameters: 'user [message]',
    description: 'identify a user',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.op = {
    parameters: 'user',
    description: 'give operator status',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.unop = {
    parameters: 'user',
    description: 'revoke operator status',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.present = {
    parameters: 'user',
    description: 'give user the right to present',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.unpresent = {
    parameters: 'user',
    description: 'revoke the right to present',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.shutup = {
    parameters: 'user',
    description: 'revoke the right to send chat messages',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.unshutup = {
    parameters: 'user',
    description: 'give the right to send chat messages',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.mute = {
    parameters: 'user',
    description: 'mute a remote user',
    predicate: operatorPredicate,
    f: userMessage,
};

commands.muteall = {
    description: 'mute all remote users',
    predicate: operatorPredicate,
    f: (c, r) => {
        serverConnection.userMessage('mute', null, null, true);
    }
}

commands.warn = {
    parameters: 'user message',
    description: 'send a warning to a user',
    predicate: operatorPredicate,
    f: (c, r) => {
        userMessage('warning', r);
    },
};

commands.wall = {
    parameters: 'message',
    description: 'send a warning to all users',
    predicate: operatorPredicate,
    f: (c, r) => {
        if(!r)
            throw new Error('empty message');
        serverConnection.userMessage('warning', '', r);
    },
};

commands.raise = {
    description: 'raise hand',
    f: (c, r) => {
        serverConnection.userAction(
            "setdata", serverConnection.id, {"raisehand": true},
        );
    }
}

commands.unraise = {
    description: 'unraise hand',
    f: (c, r) => {
        serverConnection.userAction(
            "setdata", serverConnection.id, {"raisehand": null},
        );
    }
}

/** @returns {boolean} */
function canFile() {
    let v =
        /** @ts-ignore */
        !!HTMLVideoElement.prototype.captureStream ||
        /** @ts-ignore */
        !!HTMLVideoElement.prototype.mozCaptureStream;
    return v;
}

function presentFile() {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept="audio/*,video/*";
    input.onchange = function(e) {
        if(!(this instanceof HTMLInputElement))
            throw new Error('Unexpected type for this');
        let files = this.files;
        for(let i = 0; i < files.length; i++) {
            addFileMedia(files[i]).catch(e => {
                console.error(e);
                displayError(e);
            });
        }
    };
    input.click();
}

commands.presentfile = {
    description: 'broadcast a video or audio file',
    f: (c, r) => {
        presentFile();
    },
    predicate: () => {
        if(!canFile())
            return 'Your browser does not support presenting arbitrary files';
        if(!serverConnection || !serverConnection.permissions ||
           serverConnection.permissions.indexOf('present') < 0)
            return 'You are not authorised to present.';
        return null;
    }
};


/**
 * @param {string} id
 */
function sendFile(id) {
    let input = document.createElement('input');
    input.type = 'file';
    input.onchange = function(e) {
        if(!(this instanceof HTMLInputElement))
            throw new Error('Unexpected type for this');
        let files = this.files;
        for(let i = 0; i < files.length; i++) {
            try {
                serverConnection.sendFile(id, files[i]);
            } catch(e) {
                console.error(e);
                displayError(e);
            }
        }
    };
    input.click();
}

commands.sendfile = {
    parameters: 'user',
    description: 'send a file (this will disclose your IP address)',
    f: (c, r) => {
        let p = parseCommand(r);
        if(!p[0])
            throw new Error(`/${c} requires parameters`);
        let id = findUserId(p[0]);
        if(!id)
            throw new Error(`Unknown user ${p[0]}`);
        sendFile(id);
    },
};

/**
 * Test loopback through a TURN relay.
 *
 * @returns {Promise<number>}
 */
async function relayTest() {
    if(!serverConnection)
        throw new Error('not connected');
    let conf = Object.assign({}, serverConnection.getRTCConfiguration());
    conf.iceTransportPolicy = 'relay';
    let pc1 = new RTCPeerConnection(conf);
    let pc2 = new RTCPeerConnection(conf);
    pc1.onicecandidate = e => {e.candidate && pc2.addIceCandidate(e.candidate);};
    pc2.onicecandidate = e => {e.candidate && pc1.addIceCandidate(e.candidate);};
    try {
        return await new Promise(async (resolve, reject) => {
            let d1 = pc1.createDataChannel('loopbackTest');
            d1.onopen = e => {
                d1.send(Date.now().toString());
            };

            let offer = await pc1.createOffer();
            await pc1.setLocalDescription(offer);
            await pc2.setRemoteDescription(pc1.localDescription);
            let answer = await pc2.createAnswer();
            await pc2.setLocalDescription(answer);
            await pc1.setRemoteDescription(pc2.localDescription);

            pc2.ondatachannel = e => {
                let d2 = e.channel;
                d2.onmessage = e => {
                    let t = parseInt(e.data);
                    if(isNaN(t))
                        reject(new Error('corrupt data'));
                    else
                        resolve(Date.now() - t);
                }
            }

            setTimeout(() => reject(new Error('timeout')), 5000);
        })
    } finally {
        pc1.close();
        pc2.close();
    }
}

commands['relay-test'] = {
    f: async (c, r) => {
        localMessage('Relay test in progress...');
        try {
            let s = Date.now();
            let rtt = await relayTest();
            let e = Date.now();
            localMessage(`Relay test successful in ${e-s}ms, RTT ${rtt}ms`);
        } catch(e) {
            localMessage(`Relay test failed: ${e}`);
        }
    }
}

function handleInput() {
    let input = /** @type {HTMLTextAreaElement} */
        (document.getElementById('input'));
    let data = input.value;
    input.value = '';

    let message, me;

    if(data === '')
        return;

    if(data[0] === '/') {
        if(data.length > 1 && data[1] === '/') {
            message = data.slice(1);
            me = false;
        } else {
            let cmd, rest;
            let space = data.indexOf(' ');
            if(space < 0) {
                cmd = data.slice(1);
                rest = '';
            } else {
                cmd = data.slice(1, space);
                rest = data.slice(space + 1);
            }

            if(cmd === 'me') {
                message = rest;
                me = true;
            } else {
                let c = commands[cmd];
                if(!c) {
                    displayError(
                        `Unknown command /${cmd}, type /help for help`
                    );
                    return;
                }
                if(c.predicate) {
                    let s = c.predicate();
                    if(s) {
                        displayError(s);
                        return;
                    }
                }
                try {
                    c.f(cmd, rest);
                } catch(e) {
                    console.error(e);
                    displayError(e);
                }
                return;
            }
        }
    } else {
        message = data;
        me = false;
    }

    if(!serverConnection || !serverConnection.socket) {
        displayError("Not connected.");
        return;
    }

    try {
        serverConnection.chat(me ? 'me' : '', '', message);
    } catch(e) {
        console.error(e);
        displayError(e);
    }
}

document.getElementById('inputform').onsubmit = function(e) {
    e.preventDefault();
    handleInput();
};

document.getElementById('input').onkeypress = function(e) {
    if(e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        handleInput();
    }
};

function chatResizer(e) {
    e.preventDefault();
    let full_width = document.getElementById("mainrow").offsetWidth;
    let left = document.getElementById("left");
    let right = document.getElementById("right");

    let start_x = e.clientX;
    let start_width = left.offsetWidth;

    function start_drag(e) {
        let left_width = (start_width + e.clientX - start_x) * 100 / full_width;
        // set min chat width to 300px
        let min_left_width = 300 * 100 / full_width;
        if (left_width < min_left_width) {
          return;
        }
        left.style.flex = left_width.toString();
        right.style.flex = (100 - left_width).toString();
    }
    function stop_drag(e) {
        document.documentElement.removeEventListener(
            'mousemove', start_drag, false,
        );
        document.documentElement.removeEventListener(
            'mouseup', stop_drag, false,
        );
    }

    document.documentElement.addEventListener(
        'mousemove', start_drag, false,
    );
    document.documentElement.addEventListener(
        'mouseup', stop_drag, false,
    );
}

document.getElementById('resizer').addEventListener('mousedown', chatResizer, false);

/**
 * @param {unknown} message
 * @param {string} [level]
 */
/**
 * Announce a non-urgent message to screen readers via a polite live region.
 * @param {string} message
 */
function announcePolite(message) {
    let el = document.getElementById('live-polite');
    if(!el)
        return;
    el.textContent = '';
    // Re-set after a tick so repeated identical messages re-announce.
    setTimeout(() => { el.textContent = message; }, 50);
}

/**
 * Cache of preloaded earcon audio elements.
 * @type {Object<string,HTMLAudioElement>}
 */
let earcons = {};

/**
 * Play a short UI sound as an audible complement to the screen-reader
 * announcements.  Files live at /sounds/<name>.wav; a missing or
 * unplayable file is silently ignored.
 * @param {string} name
 */
function playEarcon(name) {
    if(getSettings()[earconSettingKey(name)] === false)
        return;
    try {
        let a = earcons[name];
        if(!a) {
            a = new Audio(`/sounds/${name}.wav`);
            earcons[name] = a;
        }
        a.currentTime = 0;
        let p = a.play();
        if(p && typeof p.catch === 'function')
            p.catch(() => {});
    } catch(e) {
        /* ignore: earcons are best-effort */
    }
}

function displayError(message, level) {
    if(message instanceof Error)
        message = message.message;
    if(!level)
        level = "error";
    let position = 'center';
    let gravity = 'top';

    switch(level) {
    case "info":
        position = 'right';
        gravity = 'bottom';
        break;
    case "warning":
        break;
    case "kicked":
        level = "error";
        break;
    }

    let announcer = document.getElementById('announcer');
    if(announcer) {
        announcer.textContent = '';
        // Re-set after a tick so repeated identical messages re-announce.
        setTimeout(() => { announcer.textContent = message; }, 50);
    }

    /** @ts-ignore */
    Toastify({
        text: message,
        duration: 4000,
        close: true,
        position: position,
        gravity: gravity,
        className: level,
    }).showToast();
}

/**
 * @param {unknown} message
 */
function displayWarning(message) {
    return displayError(message, "warning");
}

/**
 * @param {unknown} message
 */
function displayMessage(message) {
    return displayError(message, "info");
}

document.getElementById('loginform').onsubmit = async function(e) {
    e.preventDefault();

    let form = this;
    if(!(form instanceof HTMLFormElement))
        throw new Error('Bad type for loginform');

    if(getInputElement('presentmike').checked)
        presentRequested = 'mike';
    else
        presentRequested = null;
    getInputElement('presentoff').checked = true;

    // Connect to the server, gotConnected will join.
    serverConnect();
};

document.getElementById('disconnectbutton').onclick = function(e) {
    serverConnection.close();
    closeNav();
};

function openNav() {
    document.getElementById("sidebarnav").style.width = "250px";
}

function closeNav() {
    document.getElementById("sidebarnav").style.width = "0";
}

document.getElementById('sidebarCollapse').onclick = function(e) {
    document.getElementById("left-sidebar").classList.toggle("active");
    document.getElementById("mainrow").classList.toggle("full-width-active");
};

document.getElementById('openside').onclick = function(e) {
      e.preventDefault();
      let sidewidth = document.getElementById("sidebarnav").style.width;
      if (sidewidth !== "0px" && sidewidth !== "") {
          closeNav();
          return;
      } else {
          openNav();
      }
};


document.getElementById('clodeside').onclick = function(e) {
    e.preventDefault();
    closeNav();
};

document.getElementById('collapse-video').onclick = function(e) {
    e.preventDefault();
    setVisibility('collapse-video', false);
    setVisibility('show-video', true);
    hideVideo(true);
};

document.getElementById('show-video').onclick = function(e) {
    e.preventDefault();
    setVisibility('video-container', true);
    setVisibility('collapse-video', true);
    setVisibility('show-video', false);
};

document.getElementById('close-chat').onclick = function(e) {
    e.preventDefault();
    setVisibility('left', false);
    setVisibility('show-chat', true);
    resizePeers();
};

document.getElementById('show-chat').onclick = function(e) {
    e.preventDefault();
    setVisibility('left', true);
    setVisibility('show-chat', false);
    resizePeers();
};

/**
 * Make a click-only div behave as an accessible button: focusable,
 * labelled, and activatable with Enter or Space.
 * @param {string} id
 * @param {string} label
 */
function makeAccessibleButton(id, label) {
    let el = document.getElementById(id);
    if(!el)
        return;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', label);
    el.addEventListener('keydown', function(e) {
        if(e.key !== 'Enter' && e.key !== ' ')
            return;
        e.preventDefault();
        el.click();
    });
}

makeAccessibleButton('openside', 'More options');
makeAccessibleButton('show-chat', 'Show chat');
makeAccessibleButton('close-chat', 'Hide chat');

async function serverConnect() {
    if(serverConnection && serverConnection.socket)
        serverConnection.close();
    serverConnection = new ServerConnection();
    serverConnection.onconnected = gotConnected;
    serverConnection.onerror = function(e) {
        console.error(e);
        displayError(e);
    };
    serverConnection.onpeerconnection = onPeerConnection;
    serverConnection.onclose = gotClose;
    serverConnection.ondownstream = gotDownStream;
    serverConnection.onuser = gotUser;
    serverConnection.onjoined = gotJoined;
    serverConnection.onchat = addToChatbox;
    serverConnection.onusermessage = gotUserMessage;
    serverConnection.onfiletransfer = gotFileTransfer;

    let url = groupStatus.endpoint;
    if(!url) {
        console.warn("no endpoint in status");
        url = `ws${location.protocol === 'https:' ? 's' : ''}://${location.host}/ws`;
    }

    try {
        await serverConnection.connect(url);
    } catch(e) {
        console.error(e);
        displayError(`Couldn't connect to ${url}: ${e.message}`);
    }
}

async function start() {
    try {
        let r = await fetch(".status")
        if(!r.ok)
            throw new Error(`${r.status} ${r.statusText}`);
        groupStatus = await r.json()
    } catch(e) {
        console.error(e);
        displayWarning("Couldn't fetch status: " + e);
        groupStatus = {};
    }

    if(groupStatus.name) {
        group = groupStatus.name;
    } else {
        console.warn("no group name in status");
        group = decodeURIComponent(
            location.pathname.replace(/^\/[a-z]*\//, '').replace(/\/$/, ''),
        );
    }

    // Disable simulcast on Firefox by default, it's buggy.
    if(isFirefox())
        getSelectElement('simulcastselect').value = 'off';

    let parms = new URLSearchParams(window.location.search);
    if(window.location.search)
        window.history.replaceState(null, '', window.location.pathname);
    setTitle(groupStatus.displayName || capitalise(group));

    addFilters();
    await setMediaChoices(false);
    reflectSettings();

    if(parms.has('token'))
        token = parms.get('token');

    if(token) {
        await serverConnect();
    } else if(groupStatus.authPortal) {
        window.location.href = groupStatus.authPortal;
    } else {
        setVisibility('login-container', true);
        document.getElementById('username').focus()
    }
    setViewportHeight();
}

start();
