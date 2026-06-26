/**
 * Word Manager - 词库加载与分级逻辑
 * 负责加载词库数据、管理关卡进度、处理单词生成
 */

/**
 * 与 add_audio_paths.py 保持一致的工具函数。
 *
 * - md5short(text)：旧版哈希命名（兼容历史存档），保留以便向后兼容
 * - safeFilename(text)：与 generate_voices.py / add_audio_paths.py 一致，
 *   当前权威的 mp3 文件名生成方式。人类可读、URL 友好（前端 fetch 时浏览器自动 encode）。
 */
function md5short(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
        h = ((h << 5) - h) + text.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(16).padStart(8, '0').slice(0, 8);
}

function safeFilename(name) {
    return String(name).replace(/[<>:"/\\|?*]/g, '_');
}

class WordManager {
    constructor() {
        this.wordsData = [];
        this.currentLevel = 1;
        this.totalLevels = 50;
        this.wordsPerLevel = 25;
        this.currentLevelWords = [];
        this.usedWords = [];
        this.matchedWords = [];
        this.progressData = {};
        this.missedWords = [];        // 当前关卡未掌握的目标词
        this.missCount = {};          // 当前关卡单词落地次数追踪
        this.MISS_LIMIT = 2;          // 目标词落地 2 次记为错过
        this.loaded = false;
    }

    async loadWords() {
        this.progressData = this.loadProgress();

        try {
            const response = await fetch('data/words.json');
            if (response.ok) {
                const data = await response.json();
                this.wordsData = data.words || [];
                this.loaded = true;
                return true;
            }
        } catch (error) {
            console.warn('Failed to load words.json, using fallback data');
        }

        // 使用内置的备用词库
        this.wordsData = this.getFallbackWords();
        this.loaded = true;
        return true;
    }

    getFallbackWords() {
        // 内置基础词库（当JSON加载失败时使用）
        const fallbackWords = [
            // Level 1-10 简单词汇
            { word: "apple", meaning: "苹果", difficulty: 1, letter_count: 5, audio_path: "sounds/apple.mp3" },
            { word: "banana", meaning: "香蕉", difficulty: 1, letter_count: 6, audio_path: "sounds/banana.mp3" },
            { word: "cat", meaning: "猫", difficulty: 1, letter_count: 3, audio_path: "sounds/cat.mp3" },
            { word: "dog", meaning: "狗", difficulty: 1, letter_count: 3, audio_path: "sounds/dog.mp3" },
            { word: "egg", meaning: "鸡蛋", difficulty: 1, letter_count: 3, audio_path: "sounds/egg.mp3" },
            { word: "fish", meaning: "鱼", difficulty: 1, letter_count: 4, audio_path: "sounds/fish.mp3" },
            { word: "girl", meaning: "女孩", difficulty: 1, letter_count: 4, audio_path: "sounds/girl.mp3" },
            { word: "hand", meaning: "手", difficulty: 1, letter_count: 4, audio_path: "sounds/hand.mp3" },
            { word: "ice", meaning: "冰", difficulty: 1, letter_count: 3, audio_path: "sounds/ice.mp3" },
            { word: "jump", meaning: "跳", difficulty: 1, letter_count: 4, audio_path: "sounds/jump.mp3" },
            { word: "king", meaning: "国王", difficulty: 1, letter_count: 4, audio_path: "sounds/king.mp3" },
            { word: "lion", meaning: "狮子", difficulty: 2, letter_count: 4, audio_path: "sounds/lion.mp3" },
            { word: "moon", meaning: "月亮", difficulty: 2, letter_count: 4, audio_path: "sounds/moon.mp3" },
            { word: "nest", meaning: "巢", difficulty: 2, letter_count: 4, audio_path: "sounds/nest.mp3" },
            { word: "orange", meaning: "橙子", difficulty: 2, letter_count: 6, audio_path: "sounds/orange.mp3" },
            { word: "panda", meaning: "熊猫", difficulty: 2, letter_count: 5, audio_path: "sounds/panda.mp3" },
            { word: "queen", meaning: "女王", difficulty: 2, letter_count: 5, audio_path: "sounds/queen.mp3" },
            { word: "rain", meaning: "雨", difficulty: 2, letter_count: 4, audio_path: "sounds/rain.mp3" },
            { word: "sun", meaning: "太阳", difficulty: 2, letter_count: 3, audio_path: "sounds/sun.mp3" },
            { word: "tree", meaning: "树", difficulty: 2, letter_count: 4, audio_path: "sounds/tree.mp3" },
            { word: "umbrella", meaning: "雨伞", difficulty: 3, letter_count: 8, audio_path: "sounds/umbrella.mp3" },
            { word: "violin", meaning: "小提琴", difficulty: 3, letter_count: 6, audio_path: "sounds/violin.mp3" },
            { word: "water", meaning: "水", difficulty: 3, letter_count: 5, audio_path: "sounds/water.mp3" },
            { word: "xylophone", meaning: "木琴", difficulty: 4, letter_count: 9, audio_path: "sounds/xylophone.mp3" },
            { word: "yellow", meaning: "黄色", difficulty: 3, letter_count: 6, audio_path: "sounds/yellow.mp3" },
            { word: "zebra", meaning: "斑马", difficulty: 3, letter_count: 5, audio_path: "sounds/zebra.mp3" },
            { word: "bird", meaning: "鸟", difficulty: 3, letter_count: 4, audio_path: "sounds/bird.mp3" },
            { word: "book", meaning: "书", difficulty: 3, letter_count: 4, audio_path: "sounds/book.mp3" },
            { word: "chair", meaning: "椅子", difficulty: 3, letter_count: 5, audio_path: "sounds/chair.mp3" },
            { word: "door", meaning: "门", difficulty: 3, letter_count: 4, audio_path: "sounds/door.mp3" },
            { word: "eye", meaning: "眼睛", difficulty: 3, letter_count: 3, audio_path: "sounds/eye.mp3" },
            { word: "face", meaning: "脸", difficulty: 3, letter_count: 4, audio_path: "sounds/face.mp3" },
            { word: "grass", meaning: "草", difficulty: 4, letter_count: 5, audio_path: "sounds/grass.mp3" },
            { word: "heart", meaning: "心", difficulty: 4, letter_count: 5, audio_path: "sounds/heart.mp3" },
            { word: "island", meaning: "岛屿", difficulty: 4, letter_count: 6, audio_path: "sounds/island.mp3" },
            { word: "juice", meaning: "果汁", difficulty: 4, letter_count: 5, audio_path: "sounds/juice.mp3" },
            { word: "kite", meaning: "风筝", difficulty: 4, letter_count: 4, audio_path: "sounds/kite.mp3" },
            { word: "lake", meaning: "湖", difficulty: 4, letter_count: 4, audio_path: "sounds/lake.mp3" },
            { word: "milk", meaning: "牛奶", difficulty: 4, letter_count: 4, audio_path: "sounds/milk.mp3" },
            { word: "nose", meaning: "鼻子", difficulty: 4, letter_count: 4, audio_path: "sounds/nose.mp3" }
        ];

        // 扩展到更多词汇...
        const moreWords = [
            // 添加更多基础词汇
            "able", "about", "above", "accept", "across", "action", "active",
            "add", "afraid", "after", "again", "age", "ago", "agree", "air",
            "all", "almost", "alone", "along", "already", "also", "always",
            "among", "amount", "animal", "answer", "any", "appear", "apple",
            "area", "arm", "around", "arrive", "art", "ask", "baby", "back",
            "bad", "bag", "ball", "bank", "base", "bath", "beach", "bear",
            "beat", "beautiful", "became", "because", "become", "been",
            "before", "began", "begin", "behind", "believe", "below",
            "beside", "better", "between", "big", "bird", "birth", "black",
            "blood", "blue", "board", "boat", "body", "boil", "bone", "book",
            "born", "both", "bottom", "bought", "box", "boy", "branch",
            "bread", "break", "bring", "broad", "broke", "brother", "brown",
            "brush", "build", "burn", "bus", "business", "busy", "buy",
            "cabin", "call", "came", "camp", "can", "capital", "captain",
            "car", "card", "care", "careful", "carry", "case", "cat", "catch",
            "cause", "cell", "center", "century", "certain", "chair",
            "chance", "change", "chapter", "character", "charge", "cheap",
            "check", "chicken", "child", "children", "choose", "church",
            "circle", "city", "claim", "class", "clean", "clear", "climb",
            "clock", "close", "cloth", "cloud", "coach", "coal", "coast",
            "coat", "code", "coffee", "cold", "collect", "college", "color",
            "come", "common", "company", "complete", "computer", "condition",
            "consider", "continue", "control", "cool", "copy", "corn", "corner",
            "correct", "cost", "cotton", "could", "count", "country", "course",
            "court", "cover", "cow", "create", "crop", "cross", "crowd", "cry",
            "current", "cut", "dad", "dance", "dark", "data", "daughter",
            "day", "dead", "deal", "dear", "death", "decide", "deep", "degree",
            "deliver", "demand", "department", "describe", "desert", "design",
            "determine", "develop", "did", "die", "difference", "different",
            "difficult", "dinner", "direct", "discuss", "do", "doctor", "does",
            "dog", "dollar", "done", "door", "down", "draw", "dream", "dress",
            "drink", "drive", "drop", "dry", "duck", "during", "each", "early",
            "earth", "east", "easy", "eat", "edge", "education", "effect",
            "egg", "eight", "either", "electric", "else", "end", "enemy",
            "energy", "enjoy", "enough", "enter", "entire", "equal", "escape",
            "even", "evening", "event", "ever", "every", "exact", "example",
            "exercise", "exist", "expect", "experience", "eye", "face",
            "fact", "fail", "fair", "fall", "family", "famous", "far", "farm",
            "fast", "father", "fear", "feed", "feel", "feet", "few", "field",
            "fight", "figure", "fill", "film", "final", "find", "fine", "finger",
            "finish", "fire", "firm", "first", "fish", "fit", "five", "floor",
            "flower", "fly", "follow", "food", "foot", "for", "force", "foreign",
            "forest", "forget", "form", "forward", "found", "four", "free",
            "fresh", "friend", "from", "front", "fruit", "full", "fun", "funny",
            "future", "game", "gave", "general", "get", "girl", "give", "glad",
            "glass", "go", "god", "gold", "gone", "good", "got", "govern",
            "government", "grand", "grass", "gray", "great", "green", "grew",
            "ground", "group", "grow", "guess", "guide", "hair", "half", "hall",
            "hand", "hang", "happen", "happy", "hard", "has", "hat", "have",
            "head", "hear", "heart", "heat", "heavy", "held", "help", "her",
            "here", "high", "hill", "him", "his", "history", "hit", "hold",
            "hole", "home", "hope", "horse", "hospital", "hot", "hotel", "hour",
            "house", "how", "however", "huge", "human", "hundred", "husband",
            "ice", "idea", "image", "imagine", "important", "in", "include",
            "indeed", "indicate", "industry", "information", "inside", "instead",
            "interest", "international", "into", "involve", "is", "island",
            "issue", "it", "item", "its", "itself", "just", "keep", "kept",
            "kill", "kind", "king", "kitchen", "knew", "know", "knowledge",
            "lady", "laid", "lake", "land", "language", "large", "last", "late",
            "later", "laugh", "lay", "lead", "leader", "learn", "least", "leave",
            "led", "left", "leg", "less", "let", "letter", "level", "lie",
            "life", "lift", "light", "like", "likely", "line", "list", "listen",
            "little", "live", "local", "long", "look", "lose", "lost", "lot",
            "love", "low", "machine", "made", "main", "major", "make", "man",
            "many", "map", "mark", "market", "master", "material", "matter",
            "may", "maybe", "mean", "means", "meant", "measure", "meet",
            "meeting", "member", "memory", "men", "mention", "method", "middle",
            "might", "mile", "military", "milk", "million", "mind", "minute",
            "miss", "model", "modern", "moment", "money", "month", "moon",
            "more", "morning", "most", "mother", "mountain", "mouth", "move",
            "movement", "movie", "much", "music", "must", "myself", "name",
            "nation", "national", "natural", "nature", "near", "nearly",
            "necessary", "need", "neighbor", "neither", "never", "new",
            "news", "next", "nice", "night", "nine", "no", "none", "nor",
            "north", "not", "note", "nothing", "notice", "noun", "now",
            "number", "object", "observe", "occur", "ocean", "of", "off",
            "offer", "office", "official", "often", "oh", "oil", "ok", "old",
            "on", "once", "one", "only", "onto", "open", "operation", "opinion",
            "opportunity", "or", "order", "organization", "original", "other",
            "our", "ourselves", "out", "outside", "over", "own", "owner",
            "page", "pain", "pair", "paper", "parent", "part", "particular",
            "party", "pass", "past", "patient", "pattern", "pay", "peace",
            "people", "per", "percent", "perfect", "perform", "performance",
            "perhaps", "period", "person", "personal", "phone", "physical",
            "pick", "picture", "piece", "place", "plain", "plan", "plant",
            "play", "player", "please", "point", "police", "policy", "political",
            "poor", "popular", "population", "position", "positive", "possible",
            "power", "practice", "prepare", "present", "president", "press",
            "price", "private", "probably", "problem", "process", "produce",
            "product", "production", "professional", "professor", "program",
            "project", "property", "protect", "prove", "provide", "public",
            "pull", "purpose", "put", "quality", "question", "quick", "quickly",
            "quite", "race", "radio", "raise", "ran", "range", "rate", "rather",
            "reach", "read", "ready", "real", "reality", "realize", "really",
            "reason", "receive", "recent", "recently", "record", "red",
            "reduce", "reflect", "region", "relate", "relationship", "remain",
            "remember", "remove", "repeat", "report", "represent", "require",
            "research", "resource", "respond", "response", "rest", "result",
            "return", "reveal", "rich", "right", "rise", "risk", "river",
            "road", "rock", "role", "room", "rule", "run", "safe", "said",
            "sake", "sale", "same", "save", "say", "scene", "school", "science",
            "scientist", "sea", "search", "season", "second", "section",
            "security", "see", "seek", "seem", "sell", "send", "senior",
            "sense", "series", "serious", "serve", "service", "set", "seven",
            "several", "shake", "share", "she", "short", "should", "show",
            "side", "sign", "significant", "similar", "simple", "simply",
            "since", "sing", "single", "sister", "sit", "site", "situation",
            "six", "size", "skill", "skin", "small", "smile", "so", "social",
            "society", "soldier", "some", "somebody", "someone", "something",
            "sometimes", "son", "song", "soon", "sort", "sound", "source",
            "south", "southern", "space", "speak", "special", "specific",
            "speech", "spend", "spirit", "sport", "spring", "staff", "stage",
            "stand", "standard", "star", "start", "state", "station", "stay",
            "step", "still", "stock", "stone", "stop", "store", "story",
            "straight", "strange", "strategy", "stream", "street", "strike",
            "strong", "structure", "student", "study", "stuff", "style",
            "subject", "success", "successful", "such", "suddenly", "suffer",
            "suggest", "summer", "sun", "super", "supply", "support", "sure",
            "surface", "system", "table", "take", "talk", "tax", "tea", "teach",
            "teacher", "team", "technology", "television", "tell", "ten",
            "term", "test", "than", "thank", "that", "the", "their", "them",
            "themselves", "then", "theory", "there", "these", "they", "thing",
            "think", "third", "this", "those", "though", "thought", "thousand",
            "three", "through", "throughout", "throw", "thus", "time", "to",
            "today", "together", "told", "tomorrow", "tonight", "too", "took",
            "top", "total", "tough", "toward", "town", "trade", "traditional",
            "training", "travel", "treat", "treatment", "tree", "trial", "trip",
            "trouble", "true", "truth", "try", "turn", "tv", "two", "type",
            "under", "understand", "unit", "until", "up", "upon", "us",
            "use", "usually", "value", "various", "very", "view", "village",
            "visit", "voice", "vote", "wait", "walk", "wall", "want", "war",
            "watch", "water", "way", "we", "weapon", "wear", "week", "weight",
            "well", "west", "western", "what", "whatever", "when", "where",
            "whether", "which", "while", "white", "who", "whole", "whom",
            "whose", "why", "wide", "wife", "will", "win", "window", "winter",
            "wish", "with", "within", "without", "woman", "wonder", "wood",
            "word", "work", "worker", "world", "worry", "would", "write",
            "writer", "wrong", "yard", "yeah", "year", "yellow", "yes", "yet",
            "you", "young", "your", "yourself"
        ];

        // 将moreWords转换为对象格式
        let wordId = fallbackWords.length + 1;
        for (let i = 0; i < moreWords.length; i++) {
            const word = moreWords[i];
            const difficulty = i < 500 ? Math.ceil((i + 1) / 50) : Math.ceil((i - 499) / 30) + 10;
            fallbackWords.push({
                word: word,
                meaning: '',  // 需要翻译
                difficulty: Math.min(difficulty, 50),
                letter_count: word.length,
                audio_path: `sounds/${word}.mp3`
            });
        }

        return fallbackWords;
    }

    loadProgress() {
        try {
            const saved = localStorage.getItem('wordGameProgress');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load progress:', e);
        }
        return { completedLevels: [], highScores: {}, missedWords: [], missedWordHits: {} };
    }

    // 错词本相关：保存错词到 localStorage
    saveMissedWord(wordData) {
        if (!this.progressData.missedWords) {
            this.progressData.missedWords = [];
        }
        // 避免重复添加相同单词
        const exists = this.progressData.missedWords.some(
            m => m.word === wordData.word
        );
        if (!exists) {
            this.progressData.missedWords.push({
                word: wordData.word,
                meaning: wordData.meaning,
                difficulty: wordData.difficulty,
                // ★ 关键：写入时就把音频路径存进存档
                audio_en: wordData.audio_en || `sounds/en/${safeFilename(wordData.word)}.mp3`,
                audio_zh: wordData.audio_zh || `sounds/zh/${safeFilename(wordData.meaning)}.mp3`,
                missedAt: Date.now()
            });
            this.saveProgress();
        }
    }

    getMissedWords() {
        return this.progressData.missedWords || [];
    }

    removeMissedWord(word) {
        if (!this.progressData.missedWords) return;
        this.progressData.missedWords = this.progressData.missedWords.filter(
            m => m.word !== word
        );
        // 同时清除对应的累计次数
        if (this.progressData.missedWordHits) {
            delete this.progressData.missedWordHits[word];
        }
        this.saveProgress();
    }

    // 错词关卡：记录一次正确匹配，返回累计次数
    recordMissedWordHit(word) {
        if (!this.progressData.missedWordHits) {
            this.progressData.missedWordHits = {};
        }
        if (!this.progressData.missedWordHits[word]) {
            this.progressData.missedWordHits[word] = 0;
        }
        this.progressData.missedWordHits[word]++;
        this.saveProgress();
        return this.progressData.missedWordHits[word];
    }

    // 获取错词当前的累计正确次数
    getMissedWordHits(word) {
        if (!this.progressData.missedWordHits) return 0;
        return this.progressData.missedWordHits[word] || 0;
    }

    // 错词关卡：累计 3 次正确后才算掌握（不立即删除，由 cleanupMasteredWords 统一清理）
    // 返回 { mastered: bool, hits: number, required: number }
    markMissedWordProgress(word, required = 3) {
        const hits = this.recordMissedWordHit(word);
        if (hits >= required) {
            return { mastered: true, hits, required };
        }
        return { mastered: false, hits, required };
    }

    // 清理已掌握 3 次的错词（在关卡开始或结束时调用）
    cleanupMasteredWords() {
        if (!this.progressData.missedWordHits) return;
        const hits = this.progressData.missedWordHits;
        const masteredWords = Object.keys(hits).filter(w => hits[w] >= 3);
        if (masteredWords.length > 0) {
            masteredWords.forEach(w => this.removeMissedWord(w));
        }
    }

    getMissedWordsCount() {
        return (this.progressData.missedWords || []).length;
    }

    // 记录一次目标词落地，返回是否已超过阈值需要跳过
    recordTargetMiss(word) {
        if (!this.missCount[word]) this.missCount[word] = 0;
        this.missCount[word]++;
        return this.missCount[word] >= this.MISS_LIMIT;
    }

    resetMissCount() {
        this.missCount = {};
    }

    saveProgress() {
        try {
            localStorage.setItem('wordGameProgress', JSON.stringify(this.progressData));
        } catch (e) {
            console.warn('Failed to save progress:', e);
        }
    }

    getLevelWords(level) {
        // 错题关卡：干扰词池 = 错词本中所有 difficulty 范围内的单词
        if (level === 'missed') {
            const missed = this.getMissedWords();
            if (missed.length === 0) return [];
            const difficulties = missed.map(m => m.difficulty || 5);
            const minDifficulty = Math.max(1, Math.min(...difficulties) - 3);
            const maxDifficulty = Math.min(50, Math.max(...difficulties) + 3);
            const pool = this.wordsData.filter(
                w => w.difficulty >= minDifficulty && w.difficulty <= maxDifficulty
            );
            return pool;
        }

        // 按 difficulty 字段精确匹配关卡
        let range = 0;
        let levelWords = [];

        // 逐步扩大难度范围，直到凑够每关所需单词数
        while (levelWords.length < this.wordsPerLevel && range <= 10) {
            const minDifficulty = Math.max(1, level - range);
            const maxDifficulty = Math.min(50, level + range);
            levelWords = this.wordsData.filter(
                w => w.difficulty >= minDifficulty && w.difficulty <= maxDifficulty
            );
            range++;
        }

        return levelWords.slice(0, this.wordsPerLevel);
    }

    getRandomWord(level) {
        return this.getRandomWordExclude(level, null);
    }

    getRandomWordExclude(level, excludeWord) {
        // 错题关卡：干扰词从独立的 distractorPool 选取
        let pool;
        if (level === 'missed' && this.distractorPool) {
            pool = this.distractorPool;
        } else {
            if (!this.currentLevelWords || this.currentLevelWords.length === 0) {
                this.currentLevelWords = [...this.getLevelWords(level)];
            }
            pool = this.currentLevelWords;
        }

        // 过滤掉已使用的单词和需要排除的单词
        let availableWords = pool.filter(w => !this.usedWords.includes(w.word));

        if (excludeWord) {
            availableWords = availableWords.filter(w => w.word !== excludeWord);
        }

        if (availableWords.length === 0) {
            // 重置已使用单词（但保留 excludeWord 排除）
            this.usedWords = [];
            if (excludeWord) {
                availableWords = pool.filter(w => w.word !== excludeWord);
            } else {
                availableWords = [...pool];
            }
        }

        if (availableWords.length === 0) return null;

        const randomIndex = Math.floor(Math.random() * availableWords.length);
        const word = availableWords[randomIndex];
        this.usedWords.push(word.word);

        return word;
    }

    getCurrentMeaning() {
        if (this.currentLevelWords.length === 0) {
            this.currentLevelWords = [...this.getLevelWords(this.currentLevel)];
        }

        // 错题关卡：每个错词都要匹配 3 次才算掌握
        // 排除"已达到 3 次累计正确"的单词，其他都可以再作为目标
        if (this.currentLevel === 'missed') {
            const mastered = (this.progressData.missedWordHits || {});
            let availableWords = this.currentLevelWords.filter(
                w => (mastered[w.word] || 0) < 3
            );
            if (availableWords.length === 0) {
                // 所有错词都已掌握 3 次
                return null;
            }
            const randomIndex = Math.floor(Math.random() * availableWords.length);
            return availableWords[randomIndex];
        }

        // 只排除已正确匹配的单词，不受干扰词影响
        let availableWords = this.currentLevelWords.filter(w => !this.matchedWords.includes(w.word));

        // 如果无可用单词但实际匹配数未达标，说明池被干扰词污染，重建可用列表
        if (availableWords.length === 0 && this.matchedWords.length < this.wordsPerLevel) {
            this.usedWords = [];
            availableWords = this.currentLevelWords.filter(w => !this.matchedWords.includes(w.word));
        }

        if (availableWords.length === 0) {
            return null;
        }

        // 随机打乱单词顺序，避免每次都从固定顺序开始
        const randomIndex = Math.floor(Math.random() * availableWords.length);
        return availableWords[randomIndex];
    }

    markWordAsUsed(word) {
        this.usedWords.push(word);
        if (!this.matchedWords.includes(word)) {
            this.matchedWords.push(word);
        }
    }

    isLevelComplete(level) {
        // 错题关卡：当所有错词本单词都已掌握 3 次时完成
        if (level === 'missed') {
            const missed = this.progressData.missedWords || [];
            if (missed.length === 0) return false;
            const hits = this.progressData.missedWordHits || {};
            return missed.every(m => (hits[m.word] || 0) >= 3);
        }
        return this.matchedWords.length >= this.wordsPerLevel;
    }

    setCurrentLevel(level) {
        this.currentLevel = level;
        this.usedWords = [];
        this.matchedWords = [];
        this.missedWords = [];
        this.missCount = {};
        if (level === 'missed') {
            // 进入错题关卡前，先清理已掌握 3 次的错词
            this.cleanupMasteredWords();
            // 错词关卡：目标词池 = 错词本（每个错词要重复 3 次才算掌握）
            // ★ 关键：保留 audio_en/audio_zh 字段，老存档无字段时用 fallback
            this.currentLevelWords = this.getMissedWords().map(m => ({
                word: m.word,
                meaning: m.meaning,
                difficulty: m.difficulty,
                letter_count: m.word.length,
                syllable_count: 1,
                audio_en: m.audio_en || `sounds/en/${safeFilename(m.word)}.mp3`,
                audio_zh: m.audio_zh || `sounds/zh/${safeFilename(m.meaning)}.mp3`
            }));
            // 干扰词池：错词本中所有 difficulty 范围内的单词（独立池，足够大）
            this.distractorPool = this.getLevelWords('missed');
        } else {
            this.currentLevelWords = [...this.getLevelWords(level)];
            this.distractorPool = null;
        }
    }

    // 错词关卡标记：从错词本移除已掌握单词
    markMissedWordMastered(word) {
        this.removeMissedWord(word);
    }

    getCurrentLevel() {
        return this.currentLevel;
    }

    completeLevel(level, score) {
        if (!this.progressData.completedLevels.includes(level)) {
            this.progressData.completedLevels.push(level);
        }
        if (!this.progressData.highScores[level] || score > this.progressData.highScores[level]) {
            this.progressData.highScores[level] = score;
        }
        this.saveProgress();
    }

    isLevelUnlocked(level) {
        if (level === 1) return true;
        return this.progressData.completedLevels.includes(level - 1);
    }

    isLevelCompleted(level) {
        return this.progressData.completedLevels.includes(level);
    }

    getHighScore(level) {
        return this.progressData.highScores[level] || 0;
    }

    getTotalWords() {
        return this.wordsData.length;
    }

    // 获取难度对应的样式类
    getDifficultyClass(difficulty) {
        if (difficulty <= 10) return 'easy';
        if (difficulty <= 30) return 'medium';
        return 'hard';
    }
}

// 全局词库管理器实例
const wordManager = new WordManager();
window.wordManager = wordManager;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = wordManager;
}