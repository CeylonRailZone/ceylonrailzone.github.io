#!/usr/bin/env python3
"""
render_entries.py

Usage: run from the project root (where data.html and entries/ live).
It starts a local HTTP server to serve files, opens each entries/<name>.html
via data.html?id=<name> in a headless browser, waits for JS to populate
#projectContent, and writes the rendered HTML to wiki/<name>.html.
"""

import os
import socket
import threading
import http.server
import socketserver
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# Config
ENTRIES_DIR = Path("entries")
WIKI_DIR = Path("wiki")
TEMPLATE = "data.html"
HOST = "127.0.0.1"
WAIT_TIMEOUT_MS = 15_000  # wait up to 15s for JS to render; increase if needed

# Ensure directories exist
if not ENTRIES_DIR.exists() or not ENTRIES_DIR.is_dir():
    raise SystemExit(f"Entries directory not found: {ENTRIES_DIR.resolve()}")
WIKI_DIR.mkdir(parents=True, exist_ok=True)

def find_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind((HOST, 0))
    _, port = s.getsockname()
    s.close()
    return port

class SilentHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    # reduce console noise
    def log_message(self, format, *args):
        pass

def start_http_server(port, directory):
    handler = SilentHTTPRequestHandler
    os.chdir(directory)  # serve from project root
    with socketserver.TCPServer((HOST, port), handler) as httpd:
        print(f"Serving HTTP on {HOST}:{port} (ctrl-c to stop)...")
        httpd.serve_forever()

def render_all():
    port = find_free_port()
    project_root = Path.cwd()

    # Start HTTP server in background thread
    server_thread = threading.Thread(target=start_http_server, args=(port, project_root), daemon=True)
    server_thread.start()

    # Give server a moment to start
    time.sleep(0.3)

    base_url = f"http://{HOST}:{port}"

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-gpu", "--disable-software-rasterizer"]
        )
        context = browser.new_context()

        entries = sorted([f for f in ENTRIES_DIR.iterdir() if f.is_file() and f.suffix.lower() == ".html"])
        if not entries:
            print("No .html files found in entries/. Nothing to render.")
            browser.close()
            return

        for entry in entries:
            name = entry.stem  # filename without .html
            src_url = f"{base_url}/{TEMPLATE}?id={name}"
            print(f"Rendering {entry.name}  ->  {WIKI_DIR / entry.name}")

            # Open a fresh page per entry to avoid caching/stale JS
            page = context.new_page()

            # optional: print JS errors to help debug
            page.on("console", lambda msg: print(f"  [console.{msg.type}] {msg.text}") if msg.type in ("error", "warning") else None)

            try:
                page.goto(src_url, wait_until="networkidle", timeout=20_000)

                # Wait until #projectContent is populated with meaningful content
                try:
                    page.wait_for_function(
                        """() => {
                            const el = document.getElementById('projectContent');
                            if (!el) return false;
                            const txt = (el.innerText || el.textContent || '').trim();
                            if (!txt) return false;
                            if (txt.toLowerCase().includes('loading...')) return false;
                            return true;
                        }""",
                        timeout=WAIT_TIMEOUT_MS
                    )
                except PlaywrightTimeoutError:
                    print(f"  ⚠️ Warning: timed out waiting for JS render for '{name}'. Saving current DOM anyway.")

                rendered_html = page.content()
                out_path = WIKI_DIR / entry.name
                out_path.write_text(rendered_html, encoding="utf-8")
                print(f"  ✔ Saved {out_path} (size: {out_path.stat().st_size} bytes)")

            except Exception as e:
                print(f"  ✖ Failed to render {name}: {e}")

            finally:
                page.close()  # close the page to clear state

        browser.close()

    print("Done rendering all entries.")

if __name__ == "__main__":
    render_all()
