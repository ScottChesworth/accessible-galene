// UI-mode switch and PWA registration.
//
// This lets us compare the classic web GUI against the native/app-style
// GUI on any device and screen reader, without having to install the app
// everywhere.  The chosen mode is written to the <html> element as
// data-ui="native" or data-ui="web"; other scripts and styles branch on
// that attribute.
//
// Resolution order:
//   1. ?ui=native | web | auto  in the URL (and it is remembered)
//   2. the previously remembered choice
//   3. auto (the default): native.  Native is the app-style, focus-mode
//      experience we ship by default; only an explicit web choice opts out.
//
// Note: a URL cannot make the browser draw a chromeless standalone
// window; that only happens once the PWA is installed.  The URL switch
// controls the in-page GUI behaviours, which is what we compare.
(function() {
    'use strict';

    var param = null;
    try {
        param = new URL(window.location.href).searchParams.get('ui');
    } catch(e) { /* ignore */ }

    if(param !== 'native' && param !== 'web' && param !== 'auto')
        param = null;

    function readCookie(name) {
        var m = document.cookie.match(
            new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }

    // Persist to both localStorage and a cookie.  Galène strips the ?ui=
    // query from the address bar after load, so the choice must survive on
    // its own; the cookie covers the case where localStorage is blocked.
    function persist(value) {
        try {
            window.localStorage.setItem('ui-mode', value);
        } catch(e) { /* ignore */ }
        try {
            document.cookie = 'ui-mode=' + encodeURIComponent(value) +
                '; path=/; max-age=31536000; SameSite=Lax';
        } catch(e) { /* ignore */ }
    }

    var stored = null;
    try {
        stored = window.localStorage.getItem('ui-mode');
    } catch(e) { /* ignore */ }
    if(!stored)
        stored = readCookie('ui-mode');

    if(param)
        persist(param);

    var choice = param || stored || 'auto';

    // Native is the default; only an explicit web choice opts out.
    var mode = choice === 'web' ? 'web' : 'native';

    document.documentElement.setAttribute('data-ui', mode);
    // Exposed for the app: current mode, and whether it was set explicitly
    // via the URL this load (used to confirm the mode out loud when
    // comparing).
    window.uiMode = mode;
    window.uiModeExplicit = !!param;
})();

// Register the service worker so the app is installable.  Kept separate
// from the GUI mode above: installing is optional, the mode switch works
// regardless.
if('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js').catch(function(e) {
            console.warn('Service worker registration failed:', e);
        });
    });
}
