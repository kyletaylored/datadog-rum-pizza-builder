"""Static file server for local preview that defeats browser caching.

`python3 -m http.server` sends Last-Modified, and browsers happily serve a
stale app.js / style.css from memory cache across reloads, which makes
verifying CSS and JS edits unreliable. Same directory listing behavior,
just with caching turned off.
"""
import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind="127.0.0.1")
