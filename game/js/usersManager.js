/**
 * ProfilesManager — 玩家档案管理（task #36 重构自 usersManager）
 *
 * 数据源：
 * - 服务端权威：authManager.profiles（每次切档案/登录后 fetch）
 * - 本地缓存：localStorage['wordGameProfiles_<accountId>']（离线 fallback）
 * - 当前档案：localStorage['wordGameCurrentProfile']（authManager 同步写入）
 *
 * 老 usersManager 的 API 兼容性（让 game.js 不爆）：
 * - getCurrentUser() → getCurrentProfile()（仍返回 {id, name, avatar}）
 * - listUsers() → listProfiles()
 * - getCurrentUserId() → getCurrentProfileId()
 * - createUser(name) → createProfile(name)
 * - deleteUser(id) → deleteProfile(id)
 * - switchUser(id) → switchProfile(id)
 * - renameUser(id, name) → renameProfile(id, name)
 *
 * 老数据已由 authManager.init() 在首次进入新版本时强制清理（task #36 决策：强制迁移无游客）
 */
const MAX_NICKNAME_LENGTH = 20;
const DEFAULT_AVATAR = '🦊';

class ProfilesManager {
    constructor() {
        this.profiles = [];          // 镜像自 authManager.profiles
        this.currentProfileId = null;
    }

    /** 由 authManager.init() 调用，同步 profiles 列表 */
    setProfiles(list) {
        this.profiles = Array.isArray(list) ? list : [];
        if (!this.currentProfileId || !this.profiles.some(p => p.id === this.currentProfileId)) {
            this.currentProfileId = this.profiles[0]?.id || null;
        }
    }

    // ==================== 查询 ====================

    listProfiles() { return this.profiles.slice(); }
    getProfile(id) { return this.profiles.find(p => p.id === id) || null; }
    getCurrentProfile() { return this.getProfile(this.currentProfileId); }
    getCurrentProfileId() { return this.currentProfileId; }
    getCurrentProfileName() {
        const p = this.getCurrentProfile();
        return p ? p.nickname : '';
    }

    // ==================== 向后兼容（老 API 别名） ====================

    /** @deprecated 用 getCurrentProfile() */
    getCurrentUser() {
        const p = this.getCurrentProfile();
        if (!p) return null;
        return { id: p.id, name: p.nickname, avatar: p.avatar };
    }
    /** @deprecated 用 getCurrentProfileId() */
    getCurrentUserId() { return this.getCurrentProfileId(); }
    /** @deprecated 用 getCurrentProfileName() */
    getCurrentUserName() { return this.getCurrentProfileName(); }
    /** @deprecated 用 listProfiles() */
    listUsers() { return this.listProfiles(); }

    async createUser(name) {
        return await this.createProfile(name);
    }

    async deleteUser(id) {
        return await this.deleteProfile(id);
    }

    async switchUser(id) {
        return await this.switchProfile(id);
    }

    async renameUser(id, newName) {
        return await this.renameProfile(id, newName);
    }

    // ==================== CRUD（推荐 API） ====================

    async createProfile(nickname, avatar = DEFAULT_AVATAR) {
        const trimmed = (nickname || '').trim();
        if (!trimmed) throw new Error('昵称不能为空');
        if (trimmed.length > MAX_NICKNAME_LENGTH) {
            throw new Error(`昵称不能超过 ${MAX_NICKNAME_LENGTH} 字符`);
        }
        // 防重名
        const dup = this.profiles.some(p => p.nickname.toLowerCase() === trimmed.toLowerCase());
        if (dup) throw new Error(`昵称「${trimmed}」已存在`);
        const p = await authManager.createProfile(trimmed, avatar);
        this.profiles.push(p);
        return p;
    }

    switchProfile(id) {
        // 同步切：先用本地 profiles 设置 currentProfileId，再异步通知服务器 touch
        const p = this.profiles.find(x => x.id === id);
        if (!p) throw new Error('profile 不存在');
        this.currentProfileId = p.id;
        // 异步后台同步（不阻塞调用方）
        authManager.touchProfile(p.id).catch(() => {});
        return p;
    }

    async renameProfile(id, newName) {
        const trimmed = (newName || '').trim();
        if (!trimmed) throw new Error('昵称不能为空');
        if (trimmed.length > MAX_NICKNAME_LENGTH) {
            throw new Error(`昵称不能超过 ${MAX_NICKNAME_LENGTH} 字符`);
        }
        const p = await authManager.updateProfile(id, { nickname: trimmed });
        const idx = this.profiles.findIndex(x => x.id === id);
        if (idx >= 0) this.profiles[idx] = { ...this.profiles[idx], ...p };
        return p;
    }

    async deleteProfile(id) {
        // 1. 同步清 localStorage 中该 profile 的进度 / 错词 / 词库
        try {
            const prefix1 = `wordGameProgress_${id}`;
            const prefix2 = `wordGameLibrary_${id}`;
            const removeKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && (k.startsWith(prefix1) || k.startsWith(prefix2))) {
                    removeKeys.push(k);
                }
            }
            removeKeys.forEach(k => localStorage.removeItem(k));
        } catch (e) {}
        // 2. 通知服务器删 profile
        await authManager.deleteProfile(id);
        // 3. 同步内存
        this.profiles = this.profiles.filter(p => p.id !== id);
        if (this.currentProfileId === id) {
            this.currentProfileId = this.profiles[0]?.id || null;
        }
    }

    touchLastPlayed() {
        const p = this.getCurrentProfile();
        if (p && authManager.profile?.id === p.id) {
            authManager.touchProfile(p.id);
        }
    }

    /** 兼容老 wordManager.loadWords() 调用 — 已被 authManager.init() 替代 */
    async init() {
        // profiles 已在 authManager.init() 期间从 /me 加载完毕，这里什么都不做
        return Promise.resolve();
    }
}

// 单例
const usersManager = new ProfilesManager();
const profilesManager = usersManager;  // 别名（让新代码用 profilesManager）
window.usersManager = usersManager;
window.profilesManager = profilesManager;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = usersManager;
}
