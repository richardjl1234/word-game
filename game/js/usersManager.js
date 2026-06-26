/**
 * Users Manager - 轻量多用户系统
 *
 * 用途：
 * - 多玩家共用一台设备，每个人独立的进度 + 错词
 * - 无密码，仅用昵称 + UUID 区分
 * - 后续可升级到邮箱+密码或 OAuth
 *
 * 数据模型：
 * - localStorage['wordGameUsers'] = [{id, name, createdAt, lastPlayedAt}]
 * - localStorage['wordGameCurrentUserId'] = string
 *
 * 进度/错词的 userId 分桶由各模块自己处理（librariesManager 已按 libraryId 分桶，
 * 错词 key 升级为 wordGameUser_<userId>_Library_<libraryId>_missed 由调用方组合）
 */

const MAX_NAME_LENGTH = 20;
const DEFAULT_USER_NAME = 'Player1';

class UsersManager {
    constructor() {
        this.users = [];
        this.currentUserId = null;
    }

    async init() {
        this._loadUsers();
        this._loadCurrentUserId();

        // 兼容老版本：如果旧 wordGameCurrentPlayer 存在但新 usersManager 是空的，迁移过来
        if (this.users.length === 0) {
            try {
                const oldName = localStorage.getItem('wordGameCurrentPlayer');
                if (oldName && oldName.trim()) {
                    this._createUserInternal(oldName.trim());
                    this._setCurrentUserId(this.users[0].id);
                }
            } catch (e) {
                // 忽略
            }
        }

        // 如果 currentUserId 无效（指向已删除用户），回退到第一个
        if (this.currentUserId && !this.users.some(u => u.id === this.currentUserId)) {
            if (this.users.length > 0) {
                this._setCurrentUserId(this.users[0].id);
            } else {
                this._setCurrentUserId(null);
            }
        }

        return true;
    }

    _loadUsers() {
        try {
            const raw = localStorage.getItem('wordGameUsers');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    // 过滤无效条目
                    this.users = parsed.filter(u =>
                        u && typeof u.id === 'string' && typeof u.name === 'string'
                    );
                }
            }
        } catch (e) {
            console.warn('加载用户列表失败：', e);
        }
    }

    _saveUsers() {
        try {
            localStorage.setItem('wordGameUsers', JSON.stringify(this.users));
        } catch (e) {
            console.error('保存用户列表失败：', e);
        }
    }

    _loadCurrentUserId() {
        try {
            const id = localStorage.getItem('wordGameCurrentUserId');
            if (id) this.currentUserId = id;
        } catch (e) {
            // 忽略
        }
    }

    _setCurrentUserId(id) {
        this.currentUserId = id;
        try {
            if (id) {
                localStorage.setItem('wordGameCurrentUserId', id);
            } else {
                localStorage.removeItem('wordGameCurrentUserId');
            }
        } catch (e) {
            // 忽略
        }
    }

    _generateId() {
        return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    _createUserInternal(name) {
        const id = this._generateId();
        const user = {
            id,
            name: name.slice(0, MAX_NAME_LENGTH),
            createdAt: Date.now(),
            lastPlayedAt: 0,
        };
        this.users.push(user);
        this._saveUsers();
        return user;
    }

    // ==================== 查询 ====================

    listUsers() {
        return this.users.slice();
    }

    getCurrentUser() {
        return this.users.find(u => u.id === this.currentUserId) || null;
    }

    getCurrentUserId() {
        return this.currentUserId;
    }

    getCurrentUserName() {
        const u = this.getCurrentUser();
        return u ? u.name : '';
    }

    getUser(id) {
        return this.users.find(u => u.id === id) || null;
    }

    // ==================== CRUD ====================

    /**
     * 创建新用户（自动切换到新用户）
     * @param {string} name 昵称（自动 trim + 长度限制）
     * @returns {object|null} 新用户对象，名字重复或为空返回 null
     */
    createUser(name) {
        const trimmed = (name || '').trim();
        if (!trimmed) return null;
        const final = trimmed.slice(0, MAX_NAME_LENGTH);
        // 防重名（同词库下不区分大小写不允许重复）
        const dup = this.users.some(u => u.name.toLowerCase() === final.toLowerCase());
        if (dup) return null;
        const user = this._createUserInternal(final);
        if (user) {
            // 自动切换到新用户
            this._setCurrentUserId(user.id);
        }
        return user;
    }

    renameUser(id, newName) {
        const user = this.getUser(id);
        if (!user) return false;
        const trimmed = (newName || '').trim();
        if (!trimmed) return false;
        const final = trimmed.slice(0, MAX_NAME_LENGTH);
        const dup = this.users.some(
            u => u.id !== id && u.name.toLowerCase() === final.toLowerCase()
        );
        if (dup) return false;
        user.name = final;
        this._saveUsers();
        return true;
    }

    deleteUser(id) {
        if (this.users.length <= 1) return false;       // 至少保留一个用户
        const idx = this.users.findIndex(u => u.id === id);
        if (idx === -1) return false;
        this.users.splice(idx, 1);
        this._saveUsers();
        // 清理所有 per-user-per-library 进度 key + 自定义词库错词 key
        try {
            const progressPrefix = `wordGameProgress_${id}`;
            const missedPrefix = `wordGameLibrary_${id}_`;
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (k === progressPrefix || k.startsWith(progressPrefix + '_')) {
                    keysToRemove.push(k);
                } else if (k.startsWith(missedPrefix) && k.endsWith('_missed')) {
                    keysToRemove.push(k);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (e) {}
        if (this.currentUserId === id) {
            this._setCurrentUserId(this.users[0].id);
        }
        return true;
    }

    switchUser(id) {
        const user = this.getUser(id);
        if (!user) return false;
        this._setCurrentUserId(id);
        user.lastPlayedAt = Date.now();
        this._saveUsers();
        return true;
    }

    touchLastPlayed() {
        const user = this.getCurrentUser();
        if (user) {
            user.lastPlayedAt = Date.now();
            this._saveUsers();
        }
    }
}

// 全局实例
const usersManager = new UsersManager();
window.usersManager = usersManager;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = usersManager;
}