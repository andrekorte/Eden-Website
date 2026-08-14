#!/usr/bin/env python3
"""Serve the site and a local stand-in for the Cloudflare worker.

    python3 chatbot/dev-server.py            # real replies (needs ANTHROPIC_API_KEY)
    python3 chatbot/dev-server.py --mock     # canned replies, no key, no cost

Then open http://127.0.0.1:8787/

Why --mock exists
-----------------
The widget has one security property worth testing on its own: model output is
inserted as text and never as HTML, with links added only for an exact-match
list of Eden's contact details. That property has nothing to do with the model,
so testing it should not require a model. Mock mode streams a canned reply that
deliberately contains an <img onerror=...> payload and a link to a site we do
not own. If either renders as HTML, the widget is broken — and we find out
without an API key, without a deployment, and without spending anything.

This is not the worker. It is a much smaller thing that speaks the same
protocol, so the widget cannot tell the difference. The worker's own controls
(origin allowlist, rate limiting, caps) are tested against the deployed worker,
not here.
"""

import argparse
import json
import os
import re
import sys
import http.server
import socketserver
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "chatbot", "evals"))

MOCK_REPLY = (
    "Eden helps with student visa applications, course selection and settling "
    "in once you arrive.\n\n"
    "For your own situation the team can help — message them on LINE at "
    "@edenstudentservice.\n\n"
    "<img src=x onerror=alert('xss')> "
    "<script>alert('xss')</script> "
    "[click here](https://evil.example.com) "
    "https://evil.example.com\n\n"
    # Markdown the style rule forbids but production produced anyway
    # ("**In Australia:**" on a phone, 14 Aug 2026). The widget must strip
    # these rather than display them.
    "**Sydney office** and ## a heading\n"
    "* a star bullet"
)


def load_system():
    from run import load_system as ls  # reuse the eval runner's loader
    return ls()


class Handler(http.server.SimpleHTTPRequestHandler):
    mock = False

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def _sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def _emit(self, event):
        self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode("utf-8"))
        self.wfile.flush()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        if self.path != "/chat":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length))
            messages = body["messages"]
        except Exception:
            self.send_error(400)
            return

        self._sse()

        if self.mock:
            for word in MOCK_REPLY.split(" "):
                self._emit({"type": "text", "text": word + " "})
            self._emit({"type": "done"})
            return

        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            self._emit({"type": "error", "message": "ANTHROPIC_API_KEY not set. Try --mock."})
            return

        payload = {
            "model": os.environ.get("MODEL", "claude-haiku-4-5"),
            "max_tokens": 700,
            "system": load_system(),
            "messages": messages,
        }
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
            },
        )
        try:
            data = json.loads(urllib.request.urlopen(req, timeout=90).read())
            text = "".join(b.get("text", "") for b in data.get("content", []))
            for word in text.split(" "):
                self._emit({"type": "text", "text": word + " "})
            self._emit({"type": "done"})
        except Exception as err:
            self._emit({"type": "error", "message": str(err)[:200]})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mock", action="store_true", help="canned reply, no API key needed")
    ap.add_argument("--port", type=int, default=8787)
    args = ap.parse_args()

    Handler.mock = args.mock

    # Threaded, not the default single-threaded server: a browser keeps
    # connections open, so a single-threaded server deadlocks the moment the
    # page holds one and the widget POSTs on another. Found by the widget test
    # below failing with the error fallback instead of a reply.
    class Server(socketserver.ThreadingTCPServer):
        daemon_threads = True
        allow_reuse_address = True

    with Server(("127.0.0.1", args.port), Handler) as httpd:
        print("serving %s on http://127.0.0.1:%d/%s"
              % (ROOT, args.port, "  (mock replies)" if args.mock else ""))
        httpd.serve_forever()


if __name__ == "__main__":
    main()
