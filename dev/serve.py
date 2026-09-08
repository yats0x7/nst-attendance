#!/usr/bin/env python3
"""Static server for the dev harnesses.

Sends no-store so edited modules are always re-fetched. The default
http.server honours conditional requests, which meant a changed stylesheet
could silently keep rendering the previous version during verification.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def send_header(self, keyword, value):
        if keyword.lower() in ("last-modified", "etag"):
            return
        super().send_header(keyword, value)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    ThreadingHTTPServer(("127.0.0.1", port),
                        partial(NoCacheHandler, directory=root)).serve_forever()
