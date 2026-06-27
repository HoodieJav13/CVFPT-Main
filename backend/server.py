"""
ASGI shim for the CVF PT Node.js backend.

Why this exists: the platform supervisor (read-only config) boots the backend
via `uvicorn server:app --port 8001`. This project is a Node.js/Express app,
so this module:
  1. Spawns the Node server (src/index.js) on an internal port (8002)
  2. Transparently proxies ALL HTTP traffic from 8001 -> Node

In production (Vercel), the Node app runs directly via `npm start` / serverless
and this file is NOT used. It is local-dev environment glue only.
"""
import asyncio
import atexit
import os
import subprocess
import time
from pathlib import Path

import httpx

BACKEND_DIR = Path(__file__).resolve().parent
NODE_PORT = int(os.environ.get("NODE_PORT", "8002"))
BASE_URL = f"http://127.0.0.1:{NODE_PORT}"

_node_proc = None
_client = httpx.AsyncClient(base_url=BASE_URL, timeout=httpx.Timeout(120.0))

HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length", "host",
}


def _kill_stale_node():
    subprocess.run(
        ["bash", "-lc",
         f"(fuser -k {NODE_PORT}/tcp >/dev/null 2>&1 || pkill -f 'node --watch src/index.js' >/dev/null 2>&1) || true"],
        check=False,
    )


def _start_node():
    global _node_proc
    _kill_stale_node()
    time.sleep(0.2)
    env = dict(os.environ)
    env["PORT"] = str(NODE_PORT)
    _node_proc = subprocess.Popen(
        ["node", "--watch", "src/index.js"],
        cwd=str(BACKEND_DIR),
        env=env,
    )


def _stop_node():
    global _node_proc
    if _node_proc is not None and _node_proc.poll() is None:
        _node_proc.terminate()
        try:
            _node_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _node_proc.kill()
    _node_proc = None


atexit.register(_stop_node)


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                _start_node()
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                _stop_node()
                await send({"type": "lifespan.shutdown.complete"})
                return

    if scope["type"] != "http":
        return

    # Read the full request body (Stripe webhooks need the raw bytes preserved).
    body = b""
    more = True
    while more:
        msg = await receive()
        if msg["type"] == "http.request":
            body += msg.get("body", b"")
            more = msg.get("more_body", False)
        elif msg["type"] == "http.disconnect":
            return

    raw_path = scope.get("raw_path") or scope["path"].encode("latin-1")
    if isinstance(raw_path, bytes):
        raw_path = raw_path.decode("latin-1")
    query = scope.get("query_string", b"").decode("latin-1")
    url = raw_path + (f"?{query}" if query else "")

    headers = []
    for k, v in scope.get("headers", []):
        key = k.decode("latin-1").lower()
        if key in HOP_HEADERS:
            continue
        headers.append((key, v.decode("latin-1")))

    resp = None
    for _ in range(60):
        try:
            resp = await _client.request(scope["method"], url, headers=headers, content=body)
            break
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError):
            global _node_proc
            if _node_proc is None or _node_proc.poll() is not None:
                _start_node()
            await asyncio.sleep(0.25)

    if resp is None:
        await send({"type": "http.response.start", "status": 502,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body",
                    "body": b'{"error":"Backend Node server unavailable"}'})
        return

    content = resp.content
    resp_headers = [
        (k.encode("latin-1"), v.encode("latin-1"))
        for k, v in resp.headers.items()
        if k.lower() not in ("transfer-encoding", "connection", "content-encoding", "content-length")
    ]
    resp_headers.append((b"content-length", str(len(content)).encode()))
    await send({"type": "http.response.start", "status": resp.status_code, "headers": resp_headers})
    await send({"type": "http.response.body", "body": content})
