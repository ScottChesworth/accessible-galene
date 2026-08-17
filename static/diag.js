/* Deliberately ES5 only -- no arrow functions, template literals, let or
   const.  If this page is opened in an old WebView, a syntax error would
   mean we learn nothing at all, which is the one outcome worth avoiding. */
(function() {
    'use strict';

    function has(obj, name) {
        try {
            return (obj && (name in obj)) ? 'yes' : 'no';
        } catch(e) {
            return 'error: ' + e;
        }
    }

    function safe(fn) {
        try {
            var v = fn();
            return (v === undefined || v === null) ? 'unavailable' : String(v);
        } catch(e) {
            return 'error: ' + e;
        }
    }

    var lines = [];
    function add(label, value) {
        lines.push(label + ': ' + value);
    }

    add('User agent', safe(function() { return navigator.userAgent; }));
    add('Platform', safe(function() { return navigator.platform; }));
    add('Language', safe(function() { return navigator.language; }));
    add('Screen size', safe(function() {
        return screen.width + 'x' + screen.height;
    }));
    add('Window size', safe(function() {
        return window.innerWidth + 'x' + window.innerHeight;
    }));
    add('Secure context', safe(function() {
        return ('isSecureContext' in window) ?
            window.isSecureContext : 'property missing';
    }));
    add('Page protocol', safe(function() { return location.protocol; }));

    /* A WebView-based browser (anything embedding the system web engine
       rather than being Chrome itself) puts "wv" in its user agent.  That
       is the single most useful discriminator here, since it tells us
       whether we are looking at Chrome or at a notetaker's own browser. */
    add('Looks like a WebView', safe(function() {
        return /\bwv\b/.test(navigator.userAgent) ? 'YES' : 'no';
    }));
    /* Modern Chrome freezes the Android version in the UA string at 10 and
       the model at "K", so do not trust those fields; userAgentData is
       present in Chrome but absent in older engines, which is itself a
       useful signal. */
    add('navigator.userAgentData', has(navigator, 'userAgentData'));

    add('navigator.mediaDevices', has(navigator, 'mediaDevices'));
    add('mediaDevices.getUserMedia',
        navigator.mediaDevices ?
        has(navigator.mediaDevices, 'getUserMedia') : 'n/a');
    add('mediaDevices.enumerateDevices',
        navigator.mediaDevices ?
        has(navigator.mediaDevices, 'enumerateDevices') : 'n/a');
    add('legacy navigator.getUserMedia', has(navigator, 'getUserMedia'));
    add('legacy webkitGetUserMedia', has(navigator, 'webkitGetUserMedia'));

    add('RTCPeerConnection', has(window, 'RTCPeerConnection'));
    add('webkitRTCPeerConnection', has(window, 'webkitRTCPeerConnection'));
    add('RTCPeerConnection constructs', safe(function() {
        var PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if(!PC)
            return 'no constructor';
        var pc = new PC({iceServers: []});
        pc.close();
        return 'yes';
    }));
    add('RTCRtpTransceiver', has(window, 'RTCRtpTransceiver'));

    add('WebSocket', has(window, 'WebSocket'));
    add('navigator.permissions', has(navigator, 'permissions'));
    add('AudioContext', safe(function() {
        return (window.AudioContext || window.webkitAudioContext) ?
            'yes' : 'no';
    }));
    add('Promise', has(window, 'Promise'));
    add('fetch', has(window, 'fetch'));

    /* Rough ES level probe -- tells us how old the engine is without
       putting modern syntax anywhere the parser would choke on it. */
    add('Supports ES6 syntax', safe(function() {
        try {
            /* jshint evil:true */
            eval('let x = 1; const y = () => 2; `t`;');
            return 'yes';
        } catch(e) {
            return 'no';
        }
    }));

    document.getElementById('auto').value = lines.join('\n');

    /* Browsers only expose mediaDevices in a secure context, so over plain
       http the microphone section reports a capable browser as incapable.
       Say so loudly rather than letting that be reported as a fault in the
       browser under test. */
    var secure = ('isSecureContext' in window) ? window.isSecureContext :
        (location.protocol === 'https:');
    if(!secure) {
        var warn = document.getElementById('insecure-warning');
        warn.setAttribute('role', 'alert');
        warn.style.border = '3px solid #a00';
        warn.style.padding = '0.8em';
        warn.innerHTML = '<h2>Warning: this page is not on a secure ' +
            'connection</h2><p>The address does not start with https, so ' +
            'the browser hides the microphone feature no matter how ' +
            'capable it is. The microphone test in section 4 will fail ' +
            'for that reason alone and will not tell us anything. Please ' +
            'ask for an https version of this link before continuing.</p>';
    }

    document.getElementById('livebtn').onclick = function() {
        var el = document.getElementById('live-a');
        el.textContent = '';
        setTimeout(function() {
            el.textContent = 'live region test succeeded';
        }, 120);
    };

    var toggle = document.getElementById('togglebtn');
    toggle.onclick = function() {
        var pressed = this.getAttribute('aria-pressed') === 'true';
        this.setAttribute('aria-pressed', pressed ? 'false' : 'true');
    };

    document.getElementById('micbtn').onclick = function() {
        var out = document.getElementById('micresult');
        out.value = 'Asking for permission...';
        var md = navigator.mediaDevices;
        if(!md || !md.getUserMedia) {
            out.value = !secure ?
                'INCONCLUSIVE: the page is not on https, so the browser ' +
                'hides the microphone feature regardless of whether it ' +
                'supports it. This result says nothing about the browser.' :
                'FAILED IMMEDIATELY: this browser is on a secure ' +
                'connection and still has no mediaDevices.getUserMedia, ' +
                'so it cannot ask for the microphone at all.';
            return;
        }
        try {
            md.getUserMedia({audio: true}).then(function(stream) {
                var label = 'unknown';
                try {
                    label = stream.getAudioTracks()[0].label || '(no label)';
                } catch(e) { }
                out.value = 'SUCCESS: microphone access granted. ' +
                    'Track label: ' + label;
                try {
                    var tracks = stream.getTracks();
                    for(var i = 0; i < tracks.length; i++)
                        tracks[i].stop();
                } catch(e) { }
            })['catch'](function(err) {
                out.value = 'REFUSED OR FAILED: ' + (err && err.name) +
                    ' -- ' + (err && err.message);
            });
        } catch(e) {
            out.value = 'THREW AN ERROR: ' + e;
        }
    };

    function buildResults() {
        var out = [];
        out.push('=== AUTOMATIC REPORT ===');
        out.push(document.getElementById('auto').value);
        out.push('');
        out.push('=== TOGGLE STATE AT END ===');
        out.push('aria-pressed is now: ' +
                 toggle.getAttribute('aria-pressed'));
        out.push('');
        out.push('=== MICROPHONE TEST ===');
        out.push(document.getElementById('micresult').value);
        out.push('');
        out.push('=== NOTES ===');
        out.push(document.getElementById('notes').value);
        var text = out.join('\n');
        document.getElementById('results').value = text;
        return text;
    }

    document.getElementById('gather').onclick = function() {
        buildResults();
        document.getElementById('results').focus();
    };

    function setCopyStatus(msg) {
        document.getElementById('copystatus').textContent = msg;
    }

    /* Two ways to copy, because neither is universal: the clipboard API
       needs a secure context and a recent engine, while execCommand is
       deprecated but is all an older WebView has.  Try the modern one and
       fall back, and if both fail say so plainly rather than leaving them
       to guess whether it worked. */
    function legacyCopy(area) {
        try {
            area.focus();
            area.select();
            if(area.setSelectionRange)
                area.setSelectionRange(0, area.value.length);
            return document.execCommand('copy') ? 'ok' : 'refused';
        } catch(e) {
            return 'error: ' + e;
        }
    }

    document.getElementById('copy').onclick = function() {
        var text = buildResults();
        var area = document.getElementById('results');
        setCopyStatus('Copying...');
        var done = function() {
            setCopyStatus('Copied. The results are on the clipboard, ' +
                          'ready to paste into your reply.');
        };
        if(navigator.clipboard && navigator.clipboard.writeText) {
            try {
                navigator.clipboard.writeText(text).then(done)['catch'](
                    function() {
                        var r = legacyCopy(area);
                        setCopyStatus(r === 'ok' ?
                            'Copied. The results are on the clipboard, ' +
                            'ready to paste into your reply.' :
                            'Could not copy automatically. Please select ' +
                            'all of the text in the results box below and ' +
                            'copy it by hand.');
                    });
                return;
            } catch(e) { }
        }
        var res = legacyCopy(area);
        if(res === 'ok')
            done();
        else
            setCopyStatus('Could not copy automatically. Please select ' +
                          'all of the text in the results box below and ' +
                          'copy it by hand.');
    };
})();
