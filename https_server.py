"""
HTTPS 前端服务器（开发用自签名证书）。
解决 Chrome 对 HTTP 密码页面的安全检查导致的登录按钮无响应问题。

用法：
    ../venv/bin/python https_server.py [port] [cert_dir]

也可通过 start.sh 启动：
    ./start.sh https        # 启动 HTTPS 前端
"""
import sys
import os
import ssl
import http.server
import socketserver

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
CERT_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/.wordgame-dev-certs")

GAME_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "game")
os.chdir(GAME_DIR)

handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), handler) as httpd:
    httpd.socket = ssl.wrap_socket(
        httpd.socket,
        certfile=os.path.join(CERT_DIR, "cert.pem"),
        keyfile=os.path.join(CERT_DIR, "key.pem"),
        server_side=True,
    )
    print(f"✅ HTTPS 前端已启动: https://localhost:{PORT}")
    print(f"   证书: {CERT_DIR}（自签名，首次需点击『高级 → 继续前往』）")
    print(f"   注意：前端 URL 现在是 https，后端仍是 http://127.0.0.1:8765\n")
    httpd.serve_forever()
