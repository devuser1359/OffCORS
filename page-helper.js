(function() {
    var origFetch = window.fetch;
    var origOpen = window.XMLHttpRequest.prototype.open;
    function cleanup() {
        window.fetch = origFetch;
        window.XMLHttpRequest.prototype.open = origOpen;
        try {
            delete window.__extFetch;
            delete window.__extXhrOpen;
            delete window.__extCreateStream;
        } catch (e) {}
    }
    window.fetch = function fetch(input, init) {
        try {
            if (typeof window.__extFetch === 'function') {
                return window.__extFetch.apply(this, arguments);
            }
        } catch (e) {
            if (e && String(e.message).indexOf('dead object') !== -1) {cleanup();}
            else {throw e;}
        }
        return origFetch.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.open = function open(method, url, asyn, user, password) {
        try {
            if (typeof window.__extXhrOpen === 'function') {
                return window.__extXhrOpen.apply(this, arguments);
            }
        } catch (e) {
            if (e && String(e.message).indexOf('dead object') !== -1) {cleanup();}
            else {throw e;}
        }
        return origOpen.apply(this, arguments);
    };
    window.__extCreateStream = function(onCancel) {
        var controllerRef;
        var stream = new ReadableStream({
            start:function(controller){controllerRef = controller;},
            cancel:function(){if (typeof onCancel === 'function'){onCancel();}}
        });
        return {
            stream: stream,
            enqueue: function(chunk) { controllerRef.enqueue(chunk); },
            close: function() { controllerRef.close(); },
            error: function(err) { controllerRef.error(err); }
        };
    };
})();
