"""
Admin 权限测试（task #72：管理员/普通用户角色系统）

覆盖：
  - Register 需要 admin token
  - Admin 可创建用户
  - 普通用户注册被拒
  - 首次登录返回 must_change_password
  - Change password
  - Admin 用户管理 API
  - Admin 可操作任何词库
  - Jobs 鉴权
"""
import pytest

from app.models import Account, PlayerProfile
from app.services.dictionary import load_dictionary


@pytest.fixture(autouse=True)
def _ensure_dict_loaded():
    load_dictionary()


# ==================== Register admin-only ====================

class TestRegisterRequiresAdmin:
    def test_normal_user_cannot_register(self, client, auth_headers):
        """普通用户调用 /register → 403"""
        r = client.post("/api/auth/register", json={
            "username": "newuser",
            "password": "1234",
        }, headers=auth_headers)
        assert r.status_code == 403, r.text

    def test_register_without_token(self, client):
        """无 token 调用 /register → 401"""
        r = client.post("/api/auth/register", json={
            "username": "newuser",
            "password": "1234",
        })
        assert r.status_code == 401, r.text

    def test_admin_can_register_user(self, client, admin_headers):
        """admin 可创建新用户"""
        r = client.post("/api/auth/register", json={
            "username": "student1",
            "password": "1234",
        }, headers=admin_headers)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["account"]["role"] == "user"
        assert data["must_change_password"] is True
        assert data["profile"]["nickname"] == "student1"

    def test_register_duplicate_username(self, client, admin_headers):
        """重复用户名 → 409"""
        r = client.post("/api/auth/register", json={
            "username": "dup_user",
            "password": "1234",
        }, headers=admin_headers)
        assert r.status_code == 201
        r2 = client.post("/api/auth/register", json={
            "username": "dup_user",
            "password": "5678",
        }, headers=admin_headers)
        assert r2.status_code == 409

    def test_register_short_password(self, client, admin_headers):
        # Pydantic min_length=4 → 422 Unprocessable
        r = client.post("/api/auth/register", json={
            "username": "userabc",
            "password": "12",
        }, headers=admin_headers)
        assert r.status_code in (400, 422), r.text


# ==================== Login + must_change_password ====================

class TestLoginWithRole:
    def test_login_returns_role_and_must_change(self, client, db_session):
        """新创建的用户登录应携带 role + must_change_password"""
        from app import auth as auth_core
        from app.models import Account, PlayerProfile

        account = Account(
            id=auth_core.gen_account_id(),
            username="changeme_user",
            password_hash=auth_core.hash_password("1234"),
            role="user",
            must_change_password=True,
        )
        db_session.add(account)
        db_session.flush()
        profile = PlayerProfile(id=auth_core.gen_player_id(), account_id=account.id, nickname="changeme_user")
        db_session.add(profile)
        db_session.commit()

        r = client.post("/api/auth/login", json={
            "username": "changeme_user", "password": "1234",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["account"]["role"] == "user"
        assert data["must_change_password"] is True

    def test_admin_login_returns_role(self, client, admin_headers, admin_account):
        """admin 登录返回 role=admin"""
        r = client.post("/api/auth/login", json={
            "username": admin_account["account"]["username"],
            "password": "admin123",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["account"]["role"] == "admin"


# ==================== Change password ====================

class TestChangePassword:
    def test_change_password_clears_flag(self, client, db_session):
        """改密后 must_change_password 应变为 False"""
        from app import auth as auth_core
        from app.models import Account, PlayerProfile

        account = Account(
            id=auth_core.gen_account_id(),
            username="change_pw_user",
            password_hash=auth_core.hash_password("1234"),
            role="user",
            must_change_password=True,
        )
        db_session.add(account)
        db_session.flush()
        profile = PlayerProfile(id=auth_core.gen_player_id(), account_id=account.id, nickname="change_pw_user")
        db_session.add(profile)
        db_session.commit()

        # 登录拿 token
        r = client.post("/api/auth/login", json={
            "username": "change_pw_user", "password": "1234",
        })
        token = r.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 改密
        r2 = client.post("/api/auth/change-password", json={
            "old_password": "1234",
            "new_password": "mynewpass",
        }, headers=headers)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data["must_change_password"] is False

        # 用新密码登录
        r3 = client.post("/api/auth/login", json={
            "username": "change_pw_user", "password": "mynewpass",
        })
        assert r3.status_code == 200
        assert r3.json()["must_change_password"] is False

    def test_change_password_wrong_old_password(self, client, auth_headers):
        """旧密码错误应返回 401"""
        r = client.post("/api/auth/change-password", json={
            "old_password": "wrongpass",
            "new_password": "newpass123",
        }, headers=auth_headers)
        assert r.status_code == 401, r.text

    def test_change_password_too_short(self, client, auth_headers):
        """新密码过短应返回 400"""
        r = client.post("/api/auth/change-password", json={
            "old_password": "testpass123",
            "new_password": "12",
        }, headers=auth_headers)
        assert r.status_code in (400, 422), r.text


# ==================== Admin user management API ====================

class TestAdminUserManagement:
    def test_list_accounts_admin(self, client, admin_headers):
        """admin 可列出所有账号"""
        r = client.get("/api/admin/accounts", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    def test_list_accounts_normal_user_forbidden(self, client, auth_headers):
        """普通用户不能调 admin API"""
        r = client.get("/api/admin/accounts", headers=auth_headers)
        assert r.status_code == 403, r.text

    def test_create_account_by_admin(self, client, admin_headers, db_session):
        """admin 可通过 POST /api/admin/accounts 创建用户"""
        r = client.post("/api/admin/accounts", json={
            "username": "admin_created",
        }, headers=admin_headers)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["role"] == "user"
        assert data["must_change_password"] is True
        assert data["profile_count"] >= 1

    def test_delete_account_by_admin(self, client, admin_headers, db_session):
        """admin 可删除账号"""
        from app import auth as auth_core
        from app.models import Account

        acc = Account(
            id=auth_core.gen_account_id(),
            username="to_delete",
            password_hash=auth_core.hash_password("1234"),
            role="user",
        )
        db_session.add(acc)
        db_session.commit()

        r = client.delete(f"/api/admin/accounts/{acc.id}", headers=admin_headers)
        assert r.status_code == 204, r.text
        assert db_session.query(Account).filter(Account.id == acc.id).first() is None

    def test_admin_cannot_delete_self(self, client, admin_account, admin_headers):
        """admin 不能删自己"""
        r = client.delete(f"/api/admin/accounts/{admin_account['account']['id']}", headers=admin_headers)
        assert r.status_code == 400, r.text

    def test_reset_password(self, client, admin_headers, db_session):
        """admin 可重置密码"""
        from app import auth as auth_core
        from app.models import Account, PlayerProfile

        acc = Account(
            id=auth_core.gen_account_id(),
            username="reset_me",
            password_hash=auth_core.hash_password("oldpass"),
            role="user",
            must_change_password=False,
        )
        db_session.add(acc)
        db_session.flush()
        profile = PlayerProfile(id=auth_core.gen_player_id(), account_id=acc.id, nickname="reset_me")
        db_session.add(profile)
        db_session.commit()

        r = client.post(f"/api/admin/accounts/{acc.id}/reset-password", headers=admin_headers)
        assert r.status_code == 200, r.text

        # 验证可用新默认密码登录
        r2 = client.post("/api/auth/login", json={
            "username": "reset_me", "password": "1234",
        })
        assert r2.status_code == 200, r2.text
        assert r2.json()["must_change_password"] is True


# ==================== Admin library access ====================

class TestAdminLibraryAccess:
    def test_admin_can_see_all_libraries(self, client, admin_headers, auth_account, db_session):
        """admin 可查看所有词库（含不属于自己的）"""
        from app.models import Library

        # 创建一个属于普通用户的词库
        lib = Library(
            account_id=auth_account["account"]["id"],
            name="普通用户的词库",
            source="manual",
            word_count=0,
            level_count=1,
        )
        db_session.add(lib)
        db_session.commit()

        # admin 应能看到这个词库
        r = client.get("/api/libraries", headers=admin_headers)
        assert r.status_code == 200, r.text
        names = [l["name"] for l in r.json()]
        assert "普通用户的词库" in names

    def test_normal_user_sees_only_own_libraries(self, client, auth_headers, second_account, db_session):
        """普通用户只能看到自己的词库"""
        from app.models import Library

        lib = Library(
            account_id=second_account["account"]["id"],
            name="第二个用户的词库",
            source="manual",
            word_count=0,
            level_count=1,
        )
        db_session.add(lib)
        db_session.commit()

        r = client.get("/api/libraries", headers=auth_headers)
        names = [l["name"] for l in r.json()]
        assert "第二个用户的词库" not in names


# ==================== Jobs with auth ====================

class TestJobsAuth:
    def test_get_job_requires_auth(self, client):
        """无 token 调 /api/jobs → 401"""
        r = client.get("/api/jobs/some-job-id")
        assert r.status_code == 401, r.text

    def test_list_jobs_requires_auth(self, client):
        """无 token 调 GET /api/jobs → 401"""
        r = client.get("/api/jobs")
        assert r.status_code == 401, r.text

    def test_delete_job_requires_auth(self, client):
        """无 token 调 DELETE /api/jobs/{id} → 401"""
        r = client.delete("/api/jobs/some-job-id")
        assert r.status_code == 401, r.text
