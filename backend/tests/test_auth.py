"""
Auth API 测试（task #36 注册/登录/JWT/me）
"""
import time
import secrets


def _rand_username(prefix="u"):
    """短用户名（不超过 20 字符）：u_<8hex> = 10 字符"""
    return f"{prefix}{secrets.token_hex(4)}"


def test_register_success(client):
    username = _rand_username("reg")
    r = client.post("/api/auth/register", json={"username": username, "password": "pass123"})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["token"]
    assert d["token_type"] == "bearer"
    assert d["account"]["username"] == username
    assert d["profile"]["nickname"] == username  # 默认 profile 用 username
    assert d["profile"]["avatar"] == "🦊"


def test_register_duplicate_username(client):
    username = _rand_username("dup")
    r1 = client.post("/api/auth/register", json={"username": username, "password": "pass123"})
    assert r1.status_code == 201
    r2 = client.post("/api/auth/register", json={"username": username, "password": "pass456"})
    assert r2.status_code == 409
    assert "已被占用" in r2.json()["detail"]


def test_register_short_username(client):
    r = client.post("/api/auth/register", json={"username": "a", "password": "pass123"})
    assert r.status_code == 400


def test_register_short_password(client):
    r = client.post("/api/auth/register", json={"username": _rand_username("sp"), "password": "123"})
    assert r.status_code == 400


def test_register_invalid_username_chars(client):
    r = client.post("/api/auth/register", json={"username": "bad name!", "password": "pass123"})
    assert r.status_code == 400


def test_register_username_too_long(client):
    r = client.post("/api/auth/register", json={"username": "x" * 21, "password": "pass123"})
    assert r.status_code == 400


def test_register_supports_chinese(client):
    username = _rand_username("小明")
    r = client.post("/api/auth/register", json={"username": username, "password": "pass123"})
    assert r.status_code == 201, r.text
    assert r.json()["account"]["username"] == username


def test_login_success(client, auth_account):
    username = auth_account["account"]["username"]
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["token"]
    assert d["account"]["username"] == username
    # last_login_at 应被更新
    assert d["account"]["last_login_at"] is not None


def test_login_wrong_password(client, auth_account):
    username = auth_account["account"]["username"]
    r = client.post("/api/auth/login", json={"username": username, "password": "wrongpass"})
    assert r.status_code == 401
    assert "昵称或密码错误" in r.json()["detail"]


def test_login_nonexistent_user(client):
    r = client.post("/api/auth/login", json={"username": "nobody_exists_xxx", "password": "pass123"})
    assert r.status_code == 401


def test_me_with_token(client, auth_headers, auth_account):
    r = client.get("/api/auth/me", headers=auth_headers)
    assert r.status_code == 200
    d = r.json()
    assert d["account"]["id"] == auth_account["account"]["id"]
    assert len(d["profiles"]) == 1
    assert d["current_profile"]["id"] == auth_account["profile"]["id"]


def test_me_without_token(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    assert "缺少 Authorization Bearer token" in r.json()["detail"]


def test_me_invalid_token(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.real.jwt"})
    assert r.status_code == 401


def test_register_then_me(client):
    """注册后立刻 /me 应能拿到账号（验 token 有效性）"""
    username = _rand_username("rt")
    r1 = client.post("/api/auth/register", json={"username": username, "password": "pass123"})
    token = r1.json()["token"]
    r2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["account"]["username"] == username


def test_two_accounts_independent(client):
    """两个账号互不干扰"""
    a = client.post("/api/auth/register", json={"username": _rand_username("a"), "password": "pass123"}).json()
    b = client.post("/api/auth/register", json={"username": _rand_username("b"), "password": "pass123"}).json()
    # token 不同
    assert a["token"] != b["token"]
    # account.id 不同
    assert a["account"]["id"] != b["account"]["id"]
    # 用 a 的 token 查 me 不会看到 b 的 profile
    me_a = client.get("/api/auth/me", headers={"Authorization": f"Bearer {a['token']}"}).json()
    assert all(p["account_id"] == a["account"]["id"] for p in me_a["profiles"])
