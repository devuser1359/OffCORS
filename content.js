var pageWin = window.wrappedJSObject;
var nativeFetch = pageWin ? pageWin.fetch : null;
var nativeOpen = pageWin ? pageWin.XMLHttpRequest.prototype.open : null;
//------------------
var s = document.createElement('script');
s.src = browser.runtime.getURL('page-helper.js');
(document.head || document.documentElement).appendChild(s);
s.onload = function() { s.remove(); };
//------------------
(function() {
    'use strict';
	if (!pageWin) {return;}
    var state = { enabled: false, activationList: [] };
    function parsePatterns(rawList) {
        if (!rawList) return [];
        var lines = Array.isArray(rawList) ? rawList : rawList.split(/[\r\n]+/);
        var patterns = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            var match = line.match(/^\/(.*)\/([a-z]*)$/i);
            try {
                patterns.push(match ? new RegExp(match[1], match[2]) : new RegExp(line, 'i'));
            } catch (e) {}
        }
        return patterns;
    };
    browser.storage.local.get(['enabled', 'activationList']).then(function(res) {
        state.enabled = !!res.enabled;
        state.activationList = parsePatterns(res.activationList);
    });
    browser.storage.onChanged.addListener(function(changes, area) {
        if (area !== 'local') return;
        if (changes.enabled) state.enabled = !!changes.enabled.newValue;
        if (changes.activationList) state.activationList = parsePatterns(changes.activationList.newValue);
    });
    function shouldBypass(url) {
		if (!state.enabled || state.activationList.length === 0) { return null; }
		var resolvedHref;
		try {
			var target = new URL(url, window.location.href);
			if (target.origin === window.location.origin) return null;
			if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
			resolvedHref = target.href;
		} catch (e) { return null; }
		for (var i = 0; i < state.activationList.length; i++) {
			if (state.activationList[i].test(resolvedHref)) return resolvedHref;
		}
		return null;
	}
	function createPagePromise(executorFn) {
		var exportedExecutor = exportFunction(executorFn, pageWin);
		var args = cloneInto([exportedExecutor], pageWin, {cloneFunctions: true });
		return pageWin.Reflect.construct(pageWin.Promise, args);
	}
    // 1. FETCH
    function doFetch(url, method, headers, body, credentials, signal) {
		var port;
		try {port = browser.runtime.connect({ name: 'stream-fetch' });}
		catch (e) {
			restoreNative();
			return nativeFetch.call(pageWin, url, { method: method, headers: headers, body: body, credentials: credentials, signal: signal });
		}
		var resolveFn, rejectFn;
		var promise = createPagePromise(function(res, rej) {
			resolveFn = res;
			rejectFn = rej;
		});
		var responseResolved = false;
		var streamHelper = null;
		var fallbackChunks = [];
		function closePort() {
			if (port) {
				try { port.disconnect(); } catch (e) {}
				port = null;
			}
		}
		function flushFallbackToStream() {
			if (!streamHelper || fallbackChunks.length === 0) return;
			for (var i = 0; i < fallbackChunks.length; i++) {
				try {
					var fbBuffer = cloneInto(fallbackChunks[i].buffer, pageWin);
					streamHelper.enqueue(new pageWin.Uint8Array(fbBuffer));
				} catch (e) {}
			}
			fallbackChunks = [];
		}
		if (signal) {
			if (signal.aborted) {
				closePort();
				rejectFn(new pageWin.DOMException('The operation was aborted.', 'AbortError'));
				return promise;
			}
			signal.addEventListener('abort', exportFunction(function() {
				if (port) {
					try { port.postMessage({ type: 'abort' }); } catch (e) {}
					closePort();
				}
				var abortErr = new pageWin.DOMException('The operation was aborted.', 'AbortError');
				if (!responseResolved) {
					rejectFn(abortErr);
				} else if (streamHelper) {
					try { streamHelper.error(abortErr); } catch (e) {}
				}
			}, pageWin));
		}
		function initStreamResponse(msg) {
			if (responseResolved) {return;}
			responseResolved = true;
			var responseInit = cloneInto({
				status: msg.status,
				statusText: msg.statusText,
				headers: msg.headers
			}, pageWin);
			if (typeof pageWin.__extCreateStream === 'function') {
				var onCancel = exportFunction(function() {
					if (port) {
						try { port.postMessage({ type: 'abort' }); } catch (e) {}
						closePort();
					}
				}, pageWin);
				streamHelper = pageWin.__extCreateStream(onCancel);
				var resp = new pageWin.Response(streamHelper.stream, responseInit);
				if (msg.url) {
					try {
						Object.defineProperty(resp, 'url', {
							get: exportFunction(function() { return msg.url; }, pageWin)
						});
					} catch (e) {}
				}
				resolveFn(resp);
			}
		}
		port.onMessage.addListener(function(msg) {
			if (msg.type === 'chunk') {
				if (typeof pageWin.__extCreateStream === 'function') {
					initStreamResponse(msg);
					flushFallbackToStream();
					if (streamHelper && msg.body && msg.body.byteLength > 0) {
						try {
							var pageBuffer = cloneInto(msg.body, pageWin);
							streamHelper.enqueue(new pageWin.Uint8Array(pageBuffer));
						} catch (e) {}
					}
				} else if (msg.body && msg.body.byteLength > 0) {
					fallbackChunks.push(new Uint8Array(msg.body));
				}
			} else if (msg.type === 'done') {
				if (typeof pageWin.__extCreateStream === 'function' || responseResolved) {
					initStreamResponse(msg);
					flushFallbackToStream();
					if (streamHelper) {
						if (msg.body && msg.body.byteLength > 0) {
							try {
								var pageBuffer = cloneInto(msg.body, pageWin);
								streamHelper.enqueue(new pageWin.Uint8Array(pageBuffer));
							} catch (e) {}
						}
						try { streamHelper.close(); } catch (e) {}
					}
				} else {
					if (msg.body && msg.body.byteLength > 0) {
						fallbackChunks.push(new Uint8Array(msg.body));
					}
					var totalSize = fallbackChunks.reduce(function(acc, c) { return acc + c.length; }, 0);
					var fullBuf = new Uint8Array(totalSize);
					var offset = 0;
					for (var i = 0; i < fallbackChunks.length; i++) {
						fullBuf.set(fallbackChunks[i], offset);
						offset += fallbackChunks[i].length;
					}
					var responseInit = cloneInto({
						status: msg.status,
						statusText: msg.statusText,
						headers: msg.headers
					}, pageWin);
					var resp = new pageWin.Response(cloneInto(fullBuf.buffer, pageWin), responseInit);
					resolveFn(resp);
				}
				closePort();
			} else if (msg.type === 'aborted') {
				var abortErr = new pageWin.DOMException('The operation was aborted.', 'AbortError');
				if (!responseResolved) rejectFn(abortErr);
				else if (streamHelper) try { streamHelper.error(abortErr); } catch (e) {}
				closePort();
			} else if (msg.type === 'error') {
				var netErr = new pageWin.TypeError(msg.error || 'NetworkError');
				if (!responseResolved) rejectFn(netErr);
				else if (streamHelper) try { streamHelper.error(netErr); } catch (e) {}
				closePort();
			}
		});
		port.onDisconnect.addListener(function() {
			port = null;
		});
		port.postMessage({
			type: 'start',
			url: url,
			fetchOptions: {
				method: method || 'GET',
				headers: headers,
				body: body || null,
				credentials: credentials
			}
		});
		return promise;
	}
    pageWin.__extFetch = exportFunction(function fetch(input, init) {
        var isRequest = (input && typeof input === 'object' && typeof input.url === 'string');
        var url = (typeof input === 'string') ? input : (isRequest ? input.url : String(input));
        var fullUrl = shouldBypass(url);
		if (!fullUrl) { return nativeFetch.call(this, input, init); }
        var method = ((init && init.method) || (isRequest && input.method) || 'GET').toUpperCase();
        var signal = (init && init.signal) || (isRequest && input.signal) || null;
        var credentials = (init && init.credentials) || (isRequest && input.credentials) || 'same-origin';
        var headers = {};
        var rawHeaders = (init && init.headers) || (isRequest && input.headers);
        if (rawHeaders) {
            if (typeof rawHeaders.forEach === 'function') {
                rawHeaders.forEach(function(val, key) { headers[key] = val; });
            } else {
                for (var key in rawHeaders) {
                    if (Object.prototype.hasOwnProperty.call(rawHeaders, key))
                        headers[key] = rawHeaders[key];
                }
            }
        }
        if (init && init.body !== undefined && init.body !== null) {
            return doFetch(fullUrl, method, headers, init.body, credentials, signal);
        }
        if (isRequest && method !== 'GET' && method !== 'HEAD') {
			return input.clone().arrayBuffer().then(exportFunction(function(buf) {
				return doFetch(fullUrl, method, headers, buf.byteLength > 0 ? buf : null, credentials, signal);
			}, pageWin));
		}
        return doFetch(fullUrl, method, headers, null, credentials, signal);
    }, pageWin);
    // 2. XHR
    pageWin.__extXhrOpen = exportFunction(function open(method, url, asyn, user, password) {
		var fullUrl = shouldBypass(url);
        if (!fullUrl) {
            if (arguments.length <= 2) return nativeOpen.call(this, method, url);
            if (arguments.length === 3) return nativeOpen.call(this, method, url, asyn);
            return nativeOpen.call(this, method, url, asyn, user, password);
        }
        if (asyn === false) {
            return nativeOpen.call(this, method, url, false, user, password);
        }
        var rawXhr = this.wrappedJSObject || this;
        var customHeaders = {};
        var customReadyState = 1;
        var customStatus = 0;
        var customStatusText = '';
        var customResponse = '';
        var customResponseText = '';
        var customResponseHeaders = [];
        var customCharset = 'utf-8';
        var streamDecoder = null;
        var binaryChunks = [];
        var totalBinarySize = 0;
        var port = null;
        function closePort() {
            if (port) {
                try { port.disconnect(); } catch (e) {}
                port = null;
            }
        }
        function fireEvent(type) {
            try { rawXhr.dispatchEvent(new pageWin.Event(type)); } catch (e) {}
        }
        function appendChunkData(arrayBuffer, isDone) {
            var responseType = rawXhr.responseType || '';
            var newBytes = arrayBuffer ? new Uint8Array(arrayBuffer) : new Uint8Array(0);
            if (responseType === 'arraybuffer' || responseType === 'blob') {
                if (newBytes.length > 0) {
                    binaryChunks.push(newBytes);
                    totalBinarySize += newBytes.length;
                }
                if (isDone) {
                    var fullBuffer = new Uint8Array(totalBinarySize);
                    var offset = 0;
                    for (var i = 0; i < binaryChunks.length; i++) {
                        fullBuffer.set(binaryChunks[i], offset);
                        offset += binaryChunks[i].length;
                    }
                    binaryChunks = []; 
                    if (responseType === 'arraybuffer'){customResponse = cloneInto(fullBuffer.buffer, pageWin);}
                    else {
                        var ct = rawXhr.getResponseHeader('content-type') || 'application/octet-stream';
                        customResponse = new pageWin.Blob([cloneInto(fullBuffer.buffer, pageWin)], cloneInto({ type: ct }, pageWin));
                    }
                }
            } else {
                if (!streamDecoder) {
                    try { streamDecoder = new TextDecoder(customCharset); }
                    catch (e) { streamDecoder = new TextDecoder('utf-8'); }
                }
                if (newBytes.length > 0) {customResponseText += streamDecoder.decode(newBytes, { stream: !isDone });}
                else if (isDone){customResponseText += streamDecoder.decode(new Uint8Array(0), { stream: false });}
                if (responseType === 'json') {
                    if (isDone) {
                        try { customResponse = cloneInto(JSON.parse(customResponseText), pageWin); }
                        catch (e) { customResponse = null; }
                    }
                } else {customResponse = customResponseText;}
            }
        }
        rawXhr.overrideMimeType = exportFunction(function(mime) {
            var match = String(mime).match(/charset\s*=\s*([^\s;]+)/i);
            if (match) customCharset = match[1].toLowerCase();
        }, pageWin);
        rawXhr.setRequestHeader = exportFunction(function(header, value) {
            customHeaders[header] = value;
        }, pageWin);
        rawXhr.getResponseHeader = exportFunction(function(name) {
            if (!name) return null;
            var lower = name.toLowerCase();
            for (var i = 0; i < customResponseHeaders.length; i++) {
                if (customResponseHeaders[i][0].toLowerCase() === lower) return customResponseHeaders[i][1];
            }
            return null;
        }, pageWin);
        rawXhr.getAllResponseHeaders = exportFunction(function() {
            return customResponseHeaders.map(function(p) { return p[0] + ': ' + p[1]; }).join('\r\n');
        }, pageWin);
        rawXhr.abort = exportFunction(function() {
            if (port) {
                try { port.postMessage({ type: 'abort' }); } catch (e) {}
                closePort();
            }
            binaryChunks = [];
            totalBinarySize = 0;
            streamDecoder = null;
            customReadyState = 0;
        }, pageWin);
        Object.defineProperties(rawXhr, {
            readyState: { get: exportFunction(function() { return customReadyState; }, pageWin), configurable: true },
            status: { get: exportFunction(function() { return customStatus; }, pageWin), configurable: true },
            statusText: { get: exportFunction(function() { return customStatusText; }, pageWin), configurable: true },
            response: { get: exportFunction(function() { return customResponse; }, pageWin), configurable: true },
            responseText: { get: exportFunction(function() { return customResponseText; }, pageWin), configurable: true },
            responseURL: { get: exportFunction(function() { return fullUrl; }, pageWin), configurable: true }
        });
        fireEvent('readystatechange');
        rawXhr.send = exportFunction(function(body) {
            closePort();
            customResponse = '';
            customResponseText = '';
            streamDecoder = null;
            binaryChunks = [];
            totalBinarySize = 0;
            fireEvent('loadstart');
            port = browser.runtime.connect({ name: 'stream-fetch' });
            port.onMessage.addListener(function(msg) {
                if (msg.type === 'chunk') {
                    if (msg.url) fullUrl = msg.url;
                    customStatus = msg.status;
                    customStatusText = msg.statusText || '';
                    customResponseHeaders = msg.headers || [];
                    if (customReadyState < 2) {
                        customReadyState = 2;
                        fireEvent('readystatechange');
                    }
                    appendChunkData(msg.body, false);
                    customReadyState = 3;
                    fireEvent('readystatechange');
                    fireEvent('progress');

                } else if (msg.type === 'done') {
                    if (msg.url) fullUrl = msg.url;
                    customStatus = msg.status;
                    customStatusText = msg.statusText || '';
                    customResponseHeaders = msg.headers || [];
                    if (customReadyState < 2) {
                        customReadyState = 2;
                        fireEvent('readystatechange');
                    }
                    appendChunkData(msg.body, true);
                    customReadyState = 4;
                    fireEvent('readystatechange');
                    fireEvent('load');
                    fireEvent('loadend');
                    closePort();
                } else if (msg.type === 'aborted') {
                    customReadyState = 4;
                    fireEvent('readystatechange');
                    fireEvent('abort');
                    fireEvent('loadend');
                    closePort();
                } else if (msg.type === 'error') {
                    customReadyState = 4;
                    fireEvent('readystatechange');
                    fireEvent('error');
                    fireEvent('loadend');
                    closePort();
                }
            });
            port.onDisconnect.addListener(function() {
                port = null;
            });
            port.postMessage({
                type: 'start',
                url: fullUrl,
                fetchOptions: {
                    method: method || 'GET',
                    headers: customHeaders,
                    body: body || null,
                    credentials: rawXhr.withCredentials ? 'include' : 'same-origin'
                }
            });
        }, pageWin);
    }, pageWin);
})(window.wrappedJSObject);
