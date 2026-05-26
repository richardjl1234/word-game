/**
 * Word Manager - 词库加载与分级逻辑
 * 负责加载词库数据、管理关卡进度、处理单词生成
 */

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
        return { completedLevels: [], highScores: {} };
    }

    saveProgress() {
        try {
            localStorage.setItem('wordGameProgress', JSON.stringify(this.progressData));
        } catch (e) {
            console.warn('Failed to save progress:', e);
        }
    }

    getLevelWords(level) {
        const startIndex = (level - 1) * this.wordsPerLevel;
        const endIndex = startIndex + this.wordsPerLevel;

        // 过滤出属于该级别的单词
        const levelWords = this.wordsData.filter((w, i) => {
            const wordLevel = Math.ceil((i + 1) / this.wordsPerLevel);
            return wordLevel === level;
        });

        // 如果没有精确匹配，按难度筛选
        if (levelWords.length === 0) {
            const minDifficulty = Math.floor((level - 1) / 5) + 1;
            const maxDifficulty = Math.ceil(level / 5);

            return this.wordsData
                .filter(w => w.difficulty >= minDifficulty && w.difficulty <= maxDifficulty)
                .slice(0, this.wordsPerLevel);
        }

        return levelWords.slice(0, this.wordsPerLevel);
    }

    getRandomWord(level) {
        return this.getRandomWordExclude(level, null);
    }

    getRandomWordExclude(level, excludeWord) {
        if (!this.currentLevelWords || this.currentLevelWords.length === 0) {
            this.currentLevelWords = [...this.getLevelWords(level)];
            this.usedWords = [];
        }

        // 过滤掉已使用的单词和需要排除的单词
        let availableWords = this.currentLevelWords.filter(w => !this.usedWords.includes(w.word));

        if (excludeWord) {
            availableWords = availableWords.filter(w => w.word !== excludeWord);
        }

        if (availableWords.length === 0) {
            // 重置已使用单词
            this.usedWords = [];
            if (excludeWord) {
                availableWords = this.currentLevelWords.filter(w => w.word !== excludeWord);
            } else {
                availableWords = [...this.currentLevelWords];
            }
        }

        const randomIndex = Math.floor(Math.random() * availableWords.length);
        const word = availableWords[randomIndex];
        this.usedWords.push(word.word);

        return word;
    }

    getCurrentMeaning() {
        if (this.currentLevelWords.length === 0) {
            this.currentLevelWords = [...this.getLevelWords(this.currentLevel)];
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
        return this.matchedWords.length >= this.wordsPerLevel;
    }

    setCurrentLevel(level) {
        this.currentLevel = level;
        this.usedWords = [];
        this.matchedWords = [];
        this.currentLevelWords = [...this.getLevelWords(level)];
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = wordManager;
}