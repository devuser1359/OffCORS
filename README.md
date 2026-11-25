OffCORS is a lightweight, security-focused developer tool that lets you selectively bypass Cross-Origin Resource Sharing (CORS)
restrictions only for the specific URLs you trust.
Unlike global CORS togglers that expose your entire browser to every website, 
OffCORS stays completely inactive until you explicitly define your target URL patterns in the Activation List.

Key Features:

• Strict Whitelist Control: Uses regular expressions (one per line) so only matching cross-origin requests are proxied.

• Built-in Safety Guards: Automatically ignores same-origin requests and non-HTTP/HTTPS protocols.

• Streaming Support: Efficiently handles chunked Fetch (ReadableStream) and XMLHttpRequest streams without buffering entire files in memory.

• Clean Origin Handling: Strips the internal moz-extension:// Origin header from proxied background requests to prevent server-side rejections.

• One-Click Toggle: Quickly enable or disable the extension from the toolbar icon (green = active, red = off).

How to use:
1. Open the extension's Options page.
2. Add one or more regular expressions to the Activation List (e.g., /^https?:\/\/localhost:8080\//i or /^https:\/\/api\.example\.com\//i) and click Save.
3. Click the OffCORS toolbar icon so it turns green.
Disclaimer: Intended for local web development, API testing, and debugging purposes.
