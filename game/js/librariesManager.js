/**
 * Libraries Manager - 多词库管理
 *
 * 负责：
 * - 默认词库加载（data/words.json）
 * - 用户自定义词库 CRUD（localStorage 持久化）
 * - 当前词库切换
 * - 词库内单词增删去重
 * - 关卡切片（每 50 词为一关）
 *
 * 数据模型：
 * - 默认词库 id 固定为 'default'，单词来自 data/words.json，不存 localStorage
 * - 自定义词库 id 形如 'lib_<timestamp>_<rand>'，元数据存 wordGameLibraries，单词存 wordGameLibrary_<id>_words
 */

const DEFAULT_LIBRARY_ID = 'default';
const WORDS_PER_LEVEL_CUSTOM = 50;     // 自定义词库每关词数
const WORDS_PER_LEVEL_DEFAULT = 25;    // 默认词库每关词数（兼容旧版本）

class LibrariesManager {
    constructor() {
        this.libraries = [];             // [{id, name, isDefault, source, sourceFile?, createdAt, wordCount, levelCount}]
        this.words = {};                 // { [libraryId]: [wordObj, ...] }
        this.loaded = {};                // { [libraryId]: bool }
        this.currentLibraryId = DEFAULT_LIBRARY_ID;
    }

    /**
     * 初始化：加载默认词库 + 恢复用户词库 + 恢复当前选择 + 从后端同步
     */
    async init() {
        await this._loadDefaultLibrary();

        try {
            const raw = localStorage.getItem('wordGameLibraries');
            if (raw) {
                const userLibs = JSON.parse(raw);
                userLibs.forEach(lib => {
                    // 防御性：跳过名字为空或重复 id
                    if (!lib.id || lib.id === DEFAULT_LIBRARY_ID) return;
                    if (!lib.name) return;
                    this.libraries.push(lib);
                    this.words[lib.id] = this._loadWordsFromStorage(lib.id);
                    this.loaded[lib.id] = true;
                });
            }
        } catch (e) {
            console.warn('加载用户词库失败：', e);
        }

        // ★ 从后端 API 同步词库（合并到 localStorage）
        await this._syncFromBackend();

        try {
            const savedCurrent = localStorage.getItem('wordGameCurrentLibraryId');
            if (savedCurrent && this.libraries.some(l => l.id === savedCurrent)) {
                this.currentLibraryId = savedCurrent;
            }
        } catch (e) {
            // 忽略
        }

        return true;
    }

    /**
     * ★ 从后端 API 同步词库列表到 localStorage
     * 匹配规则：按名字匹配（不区分大小写）
     *   - 后端有 / localStorage 有 → 用后端的 ID 覆盖
     *   - 后端有 / localStorage 无 → 添加到 localStorage
     *   - 后端无 / localStorage 有 → 保留（后续上传会同步）
     */
    async _syncFromBackend() {
        const backendUrl = (window.MINIMAX_CONFIG && window.MINIMAX_CONFIG.backendUrl) || 'http://127.0.0.1:8765';
        try {
            const resp = await fetch(`${backendUrl}/api/libraries`, {
                headers: typeof authManager !== 'undefined' ? authManager.getAuthHeaders() : {},
            });
            if (!resp.ok) return;
            const backendLibs = await resp.json();
            if (!Array.isArray(backendLibs) || backendLibs.length === 0) return;

            let changed = false;
            const nameToLocal = new Map();
            for (const lib of this.libraries) {
                if (!lib.isDefault) {
                    nameToLocal.set(lib.name.toLowerCase(), lib);
                }
            }

            for (const bLib of backendLibs) {
                if (bLib.is_default) continue;
                const key = bLib.name.toLowerCase();
                const localLib = nameToLocal.get(key);

                if (localLib) {
                    // 后端存在 && localStorage 也存在 → 用后端 ID 更新
                    if (localLib.id !== bLib.id) {
                        // 如果 localStorage 有单词，先迁移到新 ID
                        const oldWords = this.words[localLib.id];
                        if (oldWords && oldWords.length > 0) {
                            this.words[bLib.id] = oldWords;
                            this.loaded[bLib.id] = true;
                            delete this.words[localLib.id];
                            delete this.loaded[localLib.id];
                            try { localStorage.removeItem(`wordGameLibrary_${localLib.id}_words`); } catch (e) {}
                        }
                        // 更新库信息为后端 ID
                        localLib.id = bLib.id;
                        localLib.wordCount = bLib.word_count;
                        localLib.levelCount = bLib.level_count;
                        // 如果当前选中的是旧 ID，更新为后端 ID
                        if (this.currentLibraryId === localLib.id) {
                            this.currentLibraryId = bLib.id;
                        }
                        changed = true;
                    }
                    // 从后端刷新单词数
                    if (bLib.word_count !== undefined) {
                        localLib.wordCount = bLib.word_count;
                        localLib.levelCount = bLib.level_count;
                    }
                } else {
                    // 后端存在 && localStorage 不存在 → 添加到 localStorage
                    const newLib = {
                        id: bLib.id,
                        name: bLib.name,
                        isDefault: false,
                        source: bLib.source || 'import',
                        createdAt: new Date(bLib.created_at || Date.now()).getTime(),
                        wordCount: bLib.word_count || 0,
                        levelCount: bLib.level_count || 1,
                    };
                    this.libraries.push(newLib);
                    this.words[newLib.id] = [];   // 占位，后续 refresh
                    this.loaded[newLib.id] = false;
                    nameToLocal.set(key, newLib);
                    changed = true;
                    // ★ 异步从后端加载单词（fire-and-forget，不阻塞 init）
                    this.refreshLibrary(newLib.id).then(result => {
                        if (result.refreshed > 0) {
                            newLib.wordCount = result.refreshed;
                            newLib.levelCount = this._calcLevelCount(newLib.id, result.refreshed);
                            this._saveUserLibraries();
                        }
                    }).catch(e => console.warn(`[LibrariesManager] 加载词库 ${newLib.id} 单词失败:`, e));
                }
            }

            if (changed) {
                this._saveUserLibraries();
                // 如果当前词库的 ID 变了，更新 localStorage 中的当前选择
                try { localStorage.setItem('wordGameCurrentLibraryId', this.currentLibraryId); } catch (e) {}
            }
            console.log(`[LibrariesManager] 后端同步完成: ${backendLibs.length} 个后端词库`);
        } catch (e) {
            // 网络错误或未登录时静默跳过
            console.warn('[LibrariesManager] 后端同步失败（可忽略）:', e.message);
        }
    }

    async _loadDefaultLibrary() {
        let words = [];
        try {
            const response = await fetch('data/words.json');
            if (response.ok) {
                const data = await response.json();
                words = data.words || [];
            }
        } catch (e) {
            console.warn('words.json 加载失败，使用 fallback');
        }

        if (words.length === 0 && typeof getFallbackWords === 'function') {
            words = getFallbackWords();
        }

        this.words[DEFAULT_LIBRARY_ID] = words;
        this.loaded[DEFAULT_LIBRARY_ID] = true;
        this.libraries.push({
            id: DEFAULT_LIBRARY_ID,
            name: '默认词库',
            isDefault: true,
            source: 'default',
            createdAt: 0,
            wordCount: words.length,
            levelCount: 50,                       // 默认词库固定 50 关
        });
    }

    _loadWordsFromStorage(libraryId) {
        try {
            const raw = localStorage.getItem(`wordGameLibrary_${libraryId}_words`);
            if (raw) return JSON.parse(raw);
        } catch (e) {
            console.warn(`加载词库 ${libraryId} 单词失败：`, e);
        }
        return [];
    }

    _saveUserLibraries() {
        const userLibs = this.libraries.filter(l => !l.isDefault);
        try {
            localStorage.setItem('wordGameLibraries', JSON.stringify(userLibs));
        } catch (e) {
            console.error('保存词库元数据失败：', e);
        }
    }

    _saveWordsToStorage(libraryId, words) {
        try {
            localStorage.setItem(`wordGameLibrary_${libraryId}_words`, JSON.stringify(words));
        } catch (e) {
            console.error(`保存词库 ${libraryId} 单词失败：`, e);
        }
        this.words[libraryId] = words;
        const lib = this.libraries.find(l => l.id === libraryId);
        if (lib) {
            lib.wordCount = words.length;
            lib.levelCount = this._calcLevelCount(libraryId, words.length);
        }
    }

    _calcLevelCount(libraryId, wordCount) {
        if (libraryId === DEFAULT_LIBRARY_ID) return 50;
        return Math.max(1, Math.ceil(wordCount / WORDS_PER_LEVEL_CUSTOM));
    }

    // ==================== 查询 API ====================

    listLibraries() {
        return this.libraries.slice();    // 返回副本防外部修改
    }

    getLibrary(id) {
        return this.libraries.find(l => l.id === id);
    }

    getCurrentLibrary() {
        return this.getLibrary(this.currentLibraryId);
    }

    getCurrentLibraryId() {
        return this.currentLibraryId;
    }

    getCurrentWords() {
        return this.words[this.currentLibraryId] || [];
    }

    getWords(libraryId) {
        return this.words[libraryId] || [];
    }

    isDefault(libraryId) {
        const lib = this.getLibrary(libraryId);
        return !!(lib && lib.isDefault);
    }

    /**
     * 切换当前词库
     * @returns {boolean} 是否成功
     */
    setCurrentLibrary(libraryId) {
        if (!this.libraries.some(l => l.id === libraryId)) return false;
        this.currentLibraryId = libraryId;
        try {
            localStorage.setItem('wordGameCurrentLibraryId', libraryId);
        } catch (e) {
            // 忽略
        }
        return true;
    }

    // ==================== 关卡切片 ====================

    /**
     * 获取某词库某关的单词（用于游戏加载）
     * 默认词库：按 difficulty 范围（兼容旧版）
     * 自定义词库：按 position 切片，每 50 词一关
     */
    getLevelWords(libraryId, level, wordsPerLevel = 25) {
        const words = this.words[libraryId] || [];
        if (level === 'missed') return words;       // 错词关返回全部作为池
        if (words.length === 0) return [];

        if (libraryId === DEFAULT_LIBRARY_ID) {
            // 旧版 difficulty 范围逻辑（保持兼容）
            let range = 0;
            let levelWords = [];
            while (levelWords.length < wordsPerLevel && range <= 10) {
                const minDifficulty = Math.max(1, level - range);
                const maxDifficulty = Math.min(50, level + range);
                levelWords = words.filter(
                    w => w.difficulty >= minDifficulty && w.difficulty <= maxDifficulty
                );
                range++;
            }
            return levelWords.slice(0, wordsPerLevel);
        }

        // 自定义词库：每 50 词一关
        const levelIdx = level - 1;
        const start = levelIdx * WORDS_PER_LEVEL_CUSTOM;
        return words.slice(start, start + WORDS_PER_LEVEL_CUSTOM);
    }

    getTotalLevels(libraryId, wordsPerLevel = 25) {
        if (libraryId === DEFAULT_LIBRARY_ID) return 50;
        return this._calcLevelCount(libraryId, (this.words[libraryId] || []).length);
    }

    getWordsPerLevel(libraryId) {
        return libraryId === DEFAULT_LIBRARY_ID ? WORDS_PER_LEVEL_DEFAULT : WORDS_PER_LEVEL_CUSTOM;
    }

    // ==================== 词库 CRUD ====================

    /**
     * 新建自定义词库
     * @param {string} name 词库名（不可与现有重复）
     * @param {string} source 'manual' | 'import:mp3' | 'import:pdf' | 'import:txt' | 'import:docx'
     * @param {string} [sourceFile] 原始文件名（import 时记录）
     * @returns {object|null} 新词库对象，失败返回 null
     */
    createLibrary(name, source = 'manual', sourceFile = null) {
        const trimmed = (name || '').trim();
        if (!trimmed) return null;
        if (trimmed.length > 30) return null;

        // 防重名（不区分大小写）
        const dup = this.libraries.some(
            l => l.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (dup) return null;

        const id = 'lib_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        const lib = {
            id,
            name: trimmed,
            isDefault: false,
            source,
            sourceFile,
            createdAt: Date.now(),
            wordCount: 0,
            levelCount: 1,
        };
        this.libraries.push(lib);
        this.words[id] = [];
        this.loaded[id] = true;
        this._saveUserLibraries();
        this._saveWordsToStorage(id, []);
        return lib;
    }

    renameLibrary(libraryId, newName) {
        const lib = this.getLibrary(libraryId);
        if (!lib || lib.isDefault) return false;
        const trimmed = (newName || '').trim();
        if (!trimmed || trimmed.length > 30) return false;
        const dup = this.libraries.some(
            l => l.id !== libraryId && l.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (dup) return false;
        lib.name = trimmed;
        this._saveUserLibraries();
        return true;
    }

    deleteLibrary(libraryId) {
        if (libraryId === DEFAULT_LIBRARY_ID) return false;
        const idx = this.libraries.findIndex(l => l.id === libraryId);
        if (idx === -1) return false;
        this.libraries.splice(idx, 1);
        delete this.words[libraryId];
        delete this.loaded[libraryId];
        try {
            localStorage.removeItem(`wordGameLibrary_${libraryId}_words`);
        } catch (e) {
            // 忽略
        }
        this._saveUserLibraries();
        if (this.currentLibraryId === libraryId) {
            this.setCurrentLibrary(DEFAULT_LIBRARY_ID);
        }
        return true;
    }

    // ==================== 后端同步 ====================

    /**
     * ★ 从后端 API 刷新词库单词（pipeline 完成后调用）
     * 取回最新单词列表并保存到 localStorage
     */
    async refreshLibrary(libraryId) {
        if (libraryId === DEFAULT_LIBRARY_ID) return { refreshed: 0 };
        const backendUrl = (window.MINIMAX_CONFIG && window.MINIMAX_CONFIG.backendUrl) || 'http://127.0.0.1:8765';
        try {
            const resp = await fetch(`${backendUrl}/api/libraries/${libraryId}/words`, {
                headers: typeof authManager !== 'undefined' ? authManager.getAuthHeaders() : {},
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const words = await resp.json();
            // 转换为 LibrariesManager 内部格式
            const formatted = words.map(w => {
                // ★ 修复路径前缀：pipeline 存的是"audio/"但前端静态路径是"sounds/"
                let audioEn = (w.audio_en || '').replace(/^audio\//, 'sounds/');
                let audioZh = (w.audio_zh || '').replace(/^audio\//, 'sounds/');
                return {
                    word: w.word,
                    meaning: w.meaning || '',
                    difficulty: w.difficulty || 5,
                    letter_count: w.word ? w.word.length : 0,
                    syllable_count: w.syllable_count || 1,
                    audio_en: audioEn,
                    audio_zh: audioZh,
                };
            });
            this._saveWordsToStorage(libraryId, formatted);
            // 同步更新 library 元数据
            const lib = this.libraries.find(l => l.id === libraryId);
            if (lib) {
                lib.wordCount = formatted.length;
                lib.levelCount = this._calcLevelCount(libraryId, formatted.length);
            }
            this._saveUserLibraries();
            console.log(`[LibrariesManager] 词库 ${libraryId} 已刷新：${formatted.length} 词`);
            return { refreshed: formatted.length };
        } catch (e) {
            console.warn(`[LibrariesManager] 刷新词库 ${libraryId} 失败：`, e);
            return { refreshed: 0, error: e.message };
        }
    }

    // ==================== 单词增删去重 ====================

    /**
     * 批量添加单词到指定词库（去重）
     * @returns {{added: number, skipped: number}}
     */
    addWords(libraryId, newWords) {
        if (libraryId === DEFAULT_LIBRARY_ID) {
            // 默认词库只读，不允许直接添加（应通过新建自定义词库）
            return { added: 0, skipped: newWords.length, reason: 'readonly' };
        }
        const existing = this.words[libraryId] || [];
        const existingSet = new Set(existing.map(w => (w.word || '').toLowerCase()));
        const toAdd = [];
        let skipped = 0;
        for (const w of newWords) {
            const key = (w.word || '').toLowerCase();
            if (!key || existingSet.has(key)) {
                skipped++;
                continue;
            }
            existingSet.add(key);
            toAdd.push({
                word: w.word,
                meaning: w.meaning || '',
                difficulty: w.difficulty || 5,
                letter_count: w.letter_count || (w.word || '').length,
                syllable_count: w.syllable_count || 1,
                audio_en: (w.audio_en || `sounds/en/${safeFilename(w.word)}.mp3`).replace(/^audio\//, 'sounds/'),
                audio_zh: (w.audio_zh || `sounds/zh/${safeFilename(w.meaning || w.word)}.mp3`).replace(/^audio\//, 'sounds/'),
                createdAt: Date.now(),
            });
        }
        if (toAdd.length > 0) {
            const updated = existing.concat(toAdd);
            this._saveWordsToStorage(libraryId, updated);
        }
        return { added: toAdd.length, skipped };
    }

    removeWord(libraryId, word) {
        if (libraryId === DEFAULT_LIBRARY_ID) return false;
        const words = this.words[libraryId] || [];
        const updated = words.filter(w => w.word !== word);
        if (updated.length === words.length) return false;
        this._saveWordsToStorage(libraryId, updated);
        return true;
    }

    /**
     * 从默认词库复制若干单词到自定义词库（用于"基于默认创建副本"）
     */
    copyFromDefault(libraryId, count = null, startPosition = 0) {
        if (libraryId === DEFAULT_LIBRARY_ID) return { copied: 0 };
        const def = this.words[DEFAULT_LIBRARY_ID] || [];
        const slice = count ? def.slice(startPosition, startPosition + count) : def.slice(startPosition);
        return this.addWords(libraryId, slice);
    }

    // ==================== 错词本（按词库分桶） ====================

    /**
     * 获取当前词库 × 当前用户的错词本 key
     */
    _missedKey(libraryId = this.currentLibraryId) {
        const userId = (typeof usersManager !== 'undefined' && usersManager.getCurrentUserId)
            ? usersManager.getCurrentUserId() : 'default';
        if (libraryId === DEFAULT_LIBRARY_ID) {
            // 默认词库沿用旧 key + userId 子 key（避免老存档被破坏）
            if (!userId || userId === 'default') {
                return 'wordGameProgress';      // 旧 key，兼容无用户场景
            }
            return `wordGameProgress_${userId}_${libraryId}`;
        }
        return `wordGameLibrary_${userId}_${libraryId}_missed`;
    }

    /**
     * 获取当前词库 × 当前用户的错词本
     */
    getMissedWords(libraryId = this.currentLibraryId) {
        try {
            const raw = localStorage.getItem(this._missedKey(libraryId));
            if (raw) return JSON.parse(raw);
        } catch (e) {
            // 忽略
        }
        return [];
    }

    saveMissedWord(libraryId, wordData) {
        const key = this._missedKey(libraryId);
        let list = [];
        try {
            const raw = localStorage.getItem(key);
            if (raw) list = JSON.parse(raw);
            else list = [];
        } catch (e) {
            list = [];
        }
        if (list.some(m => m.word === wordData.word)) return false;
        list.push({
            word: wordData.word,
            meaning: wordData.meaning,
            difficulty: wordData.difficulty,
            audio_en: wordData.audio_en || `sounds/en/${safeFilename(wordData.word)}.mp3`,
            audio_zh: wordData.audio_zh || `sounds/zh/${safeFilename(wordData.meaning)}.mp3`,
            missedAt: Date.now(),
            missCount: 1,
            hitCount: 0,
            mastered: false,
        });
        try {
            localStorage.setItem(key, JSON.stringify(list));
        } catch (e) {
            console.warn('保存错词失败：', e);
        }
        return true;
    }

    getMissedWordsCount(libraryId = this.currentLibraryId) {
        return this.getMissedWords(libraryId).length;
    }

    removeMissedWord(libraryId, word) {
        const key = this._missedKey(libraryId);
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const list = JSON.parse(raw);
            const updated = list.filter(m => m.word !== word);
            localStorage.setItem(key, JSON.stringify(updated));
        } catch (e) {
            // 忽略
        }
    }
}

// 全局实例
const librariesManager = new LibrariesManager();
window.librariesManager = librariesManager;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = librariesManager;
}