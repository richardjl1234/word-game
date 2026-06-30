"""
PlayerProfile CRUD 测试（task #36 账号下多玩家档案）
"""


def test_list_profiles_empty(client, auth_headers):
    """新注册账号应已有 1 个默认 profile"""
    r = client.get("/api/auth/me", headers=auth_headers)
    assert len(r.json()["profiles"]) == 1


def test_create_profile(client, auth_headers, auth_account):
    account_id = auth_account["account"]["id"]
    r = client.post(
        f"/api/accounts/{account_id}/profiles",
        json={"nickname": "小明", "avatar": "🐯"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["nickname"] == "小明"
    assert d["avatar"] == "🐯"
    assert d["account_id"] == account_id


def test_create_profile_duplicate_nickname(client, auth_headers, auth_account):
    """同账号下昵称不能重复"""
    account_id = auth_account["account"]["id"]
    client.post(f"/api/accounts/{account_id}/profiles", json={"nickname": "小红"}, headers=auth_headers)
    r2 = client.post(f"/api/accounts/{account_id}/profiles", json={"nickname": "小红"}, headers=auth_headers)
    assert r2.status_code == 409


def test_create_profile_other_account_forbidden(client, auth_headers, second_account):
    """不能用 A 的 token 在 B 的账号下创建 profile"""
    r = client.post(
        f"/api/accounts/{second_account['account']['id']}/profiles",
        json={"nickname": "hack"},
        headers=auth_headers,
    )
    assert r.status_code == 403


def test_list_profiles_after_create(client, auth_headers, auth_account):
    account_id = auth_account["account"]["id"]
    client.post(f"/api/accounts/{account_id}/profiles", json={"nickname": "小明"}, headers=auth_headers)
    client.post(f"/api/accounts/{account_id}/profiles", json={"nickname": "小红"}, headers=auth_headers)
    me = client.get("/api/auth/me", headers=auth_headers).json()
    nicks = sorted(p["nickname"] for p in me["profiles"])
    assert nicks == sorted([auth_account["profile"]["nickname"], "小明", "小红"])


def test_update_profile(client, auth_headers, auth_account):
    account_id = auth_account["account"]["id"]
    r = client.post(
        f"/api/accounts/{account_id}/profiles",
        json={"nickname": "小明"},
        headers=auth_headers,
    )
    pid = r.json()["id"]
    r2 = client.patch(
        f"/api/profiles/{pid}",
        json={"nickname": "大明", "avatar": "🦁"},
        headers=auth_headers,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["nickname"] == "大明"
    assert r2.json()["avatar"] == "🦁"


def test_update_profile_other_account_forbidden(client, auth_headers, auth_account, second_account):
    """A 不能改 B 账号下的 profile"""
    account_id = auth_account["account"]["id"]
    r = client.post(
        f"/api/accounts/{account_id}/profiles",
        json={"nickname": "小明"},
        headers=auth_headers,
    )
    pid = r.json()["id"]
    r2 = client.patch(
        f"/api/profiles/{pid}",
        json={"nickname": "hacked"},
        headers=second_account["headers"],
    )
    assert r2.status_code == 403


def test_delete_profile(client, auth_headers, auth_account):
    account_id = auth_account["account"]["id"]
    r = client.post(
        f"/api/accounts/{account_id}/profiles",
        json={"nickname": "小明"},
        headers=auth_headers,
    )
    pid = r.json()["id"]
    r2 = client.delete(f"/api/profiles/{pid}", headers=auth_headers)
    assert r2.status_code == 204


def test_cannot_delete_last_profile(client, auth_headers, auth_account):
    """至少保留一个 profile"""
    pid = auth_account["profile"]["id"]
    r = client.delete(f"/api/profiles/{pid}", headers=auth_headers)
    assert r.status_code == 400
    assert "至少保留一个" in r.json()["detail"]


def test_touch_profile(client, auth_headers, auth_account):
    """切换 profile 时更新 last_played_at"""
    pid = auth_account["profile"]["id"]
    r = client.post(f"/api/profiles/{pid}/touch", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["last_played_at"] is not None
