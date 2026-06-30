/**
 * AuthManager — 注册/登录/JWT 管理（task #36）
 *
 * 数据流：
 *   1. init() 从 localStorage 读 token + account + profile，调用 /api/auth/me 验证
 *   2. register()/login() 拿到 token，存 localStorage（wordGameAuthToken / wordGameAccount / wordGameCurrentProfile）
 *   3. fetch 调用通过 getAuthHeaders() 注入 Authorization: Bearer <token>
 *   4. logout() 清 localStorage，跳到 auth-screen
 *
 * 老数据兼容：第一次进入新版本强制清理 wordGameUsers / wordGameCurrentUserId / wordGameCurrentPlayer
 */
const TOKEN_KEY = 'wordGameAuthToken';
const ACCOUNT_KEY = 'wordGameAccount';
const PROFILE_KEY = 'wordGameCurrentProfile';
const PROFILES_KEY_PREFIX = 'wordGameProfiles_';  // 按 account_id 隔离

// 强制迁移要清理的老 localStorage key
const LEGACY_KEYS_TO_CLEAR = [
    'wordGameUsers',
    'wordGameCurrentUserId',
    'wordGameCurrentPlayer',
];

class AuthManager {
    constructor() {
        this.token = null;
        this.account = null;     // {id, username, created_at, last_login_at}
        this.profile = null;     // {id, account_id, nickname, avatar, ...}
        this.profiles = [];      // 该账号下所有 profiles
        this._initialized = false;
    }

    /** 启动时强制清理老游客数据（一次性） */
    _clearLegacyData() {
        let cleared = 0;
        try {
            for (const k of LEGACY_KEYS_TO_CLEAR) {
                if (localStorage.getItem(k) !== null) {
                    localStorage.removeItem(k);
                    cleared++;
                }
            }
            // 老进度/错词 key 也清理（按用户 UUID 的）
            const removeKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && (k.startsWith('wordGameProgress_') || k.startsWith('wordGameLibrary_'))) {
                    removeKeys.push(k);
                }
            }
            removeKeys.forEach(k => { localStorage.removeItem(k); cleared++; });
            if (cleared > 0) console.log(`[auth] 已清理 ${cleared} 个老游客数据 key`);
        } catch (e) {
            console.warn('清理老数据失败：', e);
        }
    }

    async init(backendUrl) {
        this.backendUrl = backendUrl || (window.MINIMAX_CONFIG?.backendUrl) || 'http://127.0.0.1:8765';

        // 强制清理一次老游客数据（每个浏览器只清一次）
        if (!localStorage.getItem('wordGameAuthMigrated_v2')) {
            this._clearLegacyData();
            localStorage.setItem('wordGameAuthMigrated_v2', '1');
        }

        this.token = localStorage.getItem(TOKEN_KEY);
        const accountRaw = localStorage.getItem(ACCOUNT_KEY);
        const profileRaw = localStorage.getItem(PROFILE_KEY);
        if (this.token && accountRaw && profileRaw) {
            try {
                this.account = JSON.parse(accountRaw);
                this.profile = JSON.parse(profileRaw);
                // 后台验证 token 有效性
                try {
                    const me = await this.fetchMe();
                    this.profiles = me.profiles || [];
                    this._initialized = true;
                    return { loggedIn: true, account: this.account, profile: this.profile };
                } catch (e) {
                    console.warn('[auth] token 已失效，重新登录', e);
                    this.logout();
                }
            } catch (e) {
                console.warn('[auth] 解析本地账号失败：', e);
                this.logout();
            }
        }
        this._initialized = true;
        return { loggedIn: false };
    }

    isLoggedIn() {
        return !!(this.token && this.account && this.profile);
    }

    /** ★ task #72：当前账号是否为 admin */
    isAdmin() {
        return this.account?.role === 'admin';
    }

    /** ★ task #72：当前账号是否需要强制改密 */
    mustChangePassword() {
        return this.account?.must_change_password === true;
    }

    getToken() { return this.token; }
    getAccountId() { return this.account?.id; }
    getProfileId() { return this.profile?.id; }

    getAuthHeaders() {
        if (!this.token) return {};
        return { Authorization: `Bearer ${this.token}` };
    }

    /** 调用后端 API 的通用方法（自动加 Bearer + 后端 URL） */
    async apiFetch(path, options = {}) {
        const url = path.startsWith('http') ? path : `${this.backendUrl}${path}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
            ...this.getAuthHeaders(),
        };
        const resp = await fetch(url, { ...options, headers });
        const ct = resp.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
            const data = await resp.json();
            if (!resp.ok) {
                const err = new Error(data.detail || `HTTP ${resp.status}`);
                err.status = resp.status;
                err.data = data;
                throw err;
            }
            return data;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp;
    }

    async register(username, password) {
        const data = await this.apiFetch('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
        this._saveSession(data);
        return data;
    }

    async login(username, password) {
        const data = await this.apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
        this._saveSession(data);
        return data;
    }

    async fetchMe() {
        return await this.apiFetch('/api/auth/me', { method: 'GET' });
    }

    /** ★ task #72：修改密码 */
    async changePassword(oldPassword, newPassword) {
        const data = await this.apiFetch('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
        });
        this._saveSession(data);
        return data;
    }

    /** 列出本账号下所有 profiles */
    async listProfiles() {
        const data = await this.apiFetch(`/api/accounts/${this.account.id}/profiles`, { method: 'GET' });
        this.profiles = data;
        return data;
    }

    async createProfile(nickname, avatar = '🦊') {
        const p = await this.apiFetch(`/api/accounts/${this.account.id}/profiles`, {
            method: 'POST',
            body: JSON.stringify({ nickname, avatar }),
        });
        this.profiles = [...(this.profiles || []), p];
        return p;
    }

    async updateProfile(profileId, patch) {
        const p = await this.apiFetch(`/api/profiles/${profileId}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        });
        this.profiles = (this.profiles || []).map(x => x.id === profileId ? { ...x, ...p } : x);
        if (this.profile?.id === profileId) this.profile = { ...this.profile, ...p };
        return p;
    }

    async deleteProfile(profileId) {
        await this.apiFetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
        this.profiles = (this.profiles || []).filter(x => x.id !== profileId);
        if (this.profile?.id === profileId) {
            // 切到第一个剩余 profile
            const next = this.profiles[0];
            if (next) await this.switchProfile(next.id);
        }
    }

    async touchProfile(profileId) {
        try {
            await this.apiFetch(`/api/profiles/${profileId}/touch`, { method: 'POST' });
        } catch (e) { /* 静默失败，不影响游戏 */ }
    }

    switchProfile(profileId) {
        const p = this.profiles.find(x => x.id === profileId) || this.profile;
        if (!p) throw new Error('profile 不存在');
        this.profile = p;
        localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
        // 同步更新 usersManager 状态（保持两边一致）
        if (typeof usersManager !== 'undefined') {
            usersManager.profiles = this.profiles;
            usersManager.currentProfileId = p.id;
        }
        // 触发 UI 刷新（如果有 game 实例）
        if (typeof game !== 'undefined' && game.updateCurrentPlayerDisplay) {
            try { game.updateCurrentPlayerDisplay(); } catch (e) {}
        }
        // 异步后台 touch（不阻塞调用方）
        this.touchProfile(p.id).catch(() => {});
        return p;
    }

    logout() {
        this.token = null;
        this.account = null;
        this.profile = null;
        this.profiles = [];
        try {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(ACCOUNT_KEY);
            localStorage.removeItem(PROFILE_KEY);
            // 注意：不清 wordGameProfiles_<accountId>，因为账号恢复时还要用
        } catch (e) {}
    }

    _saveSession(data) {
        this.token = data.token;
        this.account = data.account;
        this.profile = data.profile;
        // ★ task #72：保存响应中的 must_change_password（login/register/change-password 可能携带）
        if (data.must_change_password !== undefined && this.account) {
            this.account.must_change_password = data.must_change_password;
        }
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify(this.account));
        localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
    }
}

// 单例
const authManager = new AuthManager();
window.authManager = authManager;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = authManager;
}
