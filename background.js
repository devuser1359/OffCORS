// Based in part on CORS Everywhere by Spenibus (MIT License)
var enabled = false;
var enabledAtStartup = false;
var activationList = [];
var EXTENSION_ORIGIN = browser.runtime.getURL('').slice(0, -1);
//-----------------------
function matchesActivationList(url){
    if (!url || activationList.length === 0) {return false;}
    for (var filter of activationList) {
        var trimmed = filter.trim();
        if (!trimmed) continue;
        var pattern = trimmed.match(/^\/(.*)\/([a-z]*)$/i);
        try {
            var regex = pattern ? new RegExp(pattern[1], pattern[2]) : new RegExp(trimmed, 'i');
            if (url.match(regex)) {return true;}
        } catch(e){console.warn('[OffCORS] Invalid regex:', trimmed);}
    }
    return false;
}
//------------------------
function requestHandler(request) {
    if (request.originUrl && request.originUrl.startsWith(EXTENSION_ORIGIN)) {
        request.requestHeaders = request.requestHeaders.filter(function(h) {
            return h.name.toLowerCase() !== 'origin';
        });
    }
    return { requestHeaders: request.requestHeaders };
}
//------------------------
browser.runtime.onConnect.addListener(function(port){
	if (port.name !== 'stream-fetch') return;
	var abort = false;
	var abortController = null;
	port.onMessage.addListener(function(msg){
		if (msg.type === 'start') {
			if (!enabled || !matchesActivationList(msg.url)) {
				port.postMessage({type: 'error', error: 'Bypass disabled or URL not matched' });
				
			} else {
				abort = false;
				startPump(msg.url, msg.fetchOptions, port);
			}
		} else if (msg.type === 'abort') {
			abort = true;
			if(abortController){
			  abortController.abort();
			  abortController = null
			}
		}
	});
	port.onDisconnect.addListener(function(){
		if (abortController) {
		  abortController.abort();
		  abortController = null;
		}
	});
	function startPump(url, fetchOptions, port) {
		if (abortController) abortController.abort();
		abortController = new AbortController();
		fetchOptions.signal = abortController.signal;
		fetch(url, fetchOptions).then(function(response) {
			if (!response.body) {
				port.postMessage({
					type: 'done',
					done: true,
					url: response.url,
					status: response.status,
					statusText: response.statusText,
					headers: headersList,
					body: new ArrayBuffer(0)
				});
				return;
			}
			var headersList = [];
			response.headers.forEach(function(value, key) { headersList.push([key, value]); });
			var reader = response.body.getReader();
			var tbList = [];
			var tbSize = 0;
			function packTempBuffer() {
				if (tbSize === 0) return new ArrayBuffer(0);
				var ma = new Uint8Array(tbSize);
				var offset = 0;
				for (var i = 0; i < tbList.length; i++) {
					ma.set(tbList[i], offset);
					offset += tbList[i].length;
				}
				tbList = [];
				tbSize = 0;
				return ma.buffer;
			}
			function getData() {
				return reader.read().then(function(result) {
					if (result.done) {
						port.postMessage({
							type: 'done',
							done: true,
							url: response.url,
							status: response.status,
							statusText: response.statusText,
							headers: headersList,
							body: packTempBuffer()
						});
						return;
					}
					var value = result.value;
					tbList.push(value);
					tbSize += value.byteLength;
					if (tbSize >= 65536) {
						port.postMessage({
							type: 'chunk',
							done: false,
							url: response.url,
							status: response.status,
							statusText: response.statusText,
							headers: headersList,
							body: packTempBuffer()
						});
					}
					return getData();
				});
			}
			return getData();
		}).catch(function(err) {
			try {
				if (err.name === 'AbortError') { port.postMessage({ type: 'aborted' }); }
				else { port.postMessage({ type: 'error', error: String(err) }); }
			} catch (e) {}
		});
	}

});
//------------------------
function updateButton() {
    var buttonStatus = enabled ? 'on' : 'off';
    var buttonTitle = enabled ? 'OffCORS enabled (using activation whitelist)' : 'OffCORS disabled';
    browser.browserAction.setIcon({ path: 'icons/icon-' + buttonStatus + '.svg' });
    browser.browserAction.setTitle({ title: buttonTitle });
}
//------------------------
function loadPrefs(callback) {
    browser.storage.local.get([
        'enabledAtStartup',
        'activationList'
    ]).then(function(res) {
        enabledAtStartup = res.enabledAtStartup || false;
        var rawList = res.activationList || '';
        activationList = rawList ? rawList.split(/[\r\n]+/) : [];
        if (callback) { callback(); }
    });
}
//------------------------
function toggle(state) {
    if (typeof state === 'boolean') { enabled = state; }
    else { enabled = !enabled; }
    browser.storage.local.set({ enabled: enabled });
    updateButton();
    if (enabled) {
        browser.webRequest.onBeforeSendHeaders.addListener(
            requestHandler,
            { urls: ['<all_urls>'], tabId: -1 },
            ['blocking', 'requestHeaders']
        );
    } else {
        browser.webRequest.onBeforeSendHeaders.removeListener(requestHandler);
    }
};
browser.browserAction.onClicked.addListener(function() { toggle(); });
loadPrefs(function() {
    if (enabledAtStartup) { toggle(true); }
    else { browser.storage.local.set({ enabled: false }); }
    updateButton();
});
