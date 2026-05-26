/**
 * Game Engine - 游戏引擎核心
 * 主游戏循环、状态管理、分数逻辑
 */

class Game {
    constructor() {
        this.currentScreen = 'start-screen';
        this.score = 0;
        this.totalScore = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.lives = 3;
        this.maxErrors = 4;
        this.errorCount = 0;
        this.currentLevel = 1;
        this.isPaused = false;
        this.isRunning = false;
        this.gameLoopId = null;
        this.lastFrameTime = 0;
        this.wordSpawnTimer = 0;
        this.activeWords = [];
        this.maxActiveWords = 3;
        this.wordSpeed = 1;
        this.targetMeaning = null;

        // 初始化各模块
        this.soundManager = null;
        this.animationPlayer = null;
        this.wordManager = null;
        this.collisionDetector = null;

        // DOM元素
        this.screens = {};
        this.elements = {};
    }

    async init() {
        // 等待DOM加载完成
        if (document.readyState === 'loading') {
            await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
        }

        // 初始化各个管理器
        this.soundManager = window.soundManager || new SoundManager();
        this.animationPlayer = window.animationPlayer || new AnimationPlayer();
        this.wordManager = window.wordManager || new WordManager();
        this.collisionDetector = window.collisionDetector || new CollisionDetector();

        // 初始化音效和动画播放器
        await this.soundManager.init();
        this.animationPlayer.init('animation-layer');

        // 加载词库
        await this.wordManager.loadWords();

        // 缓存DOM元素
        this.cacheElements();

        // 设置事件监听
        this.bindEvents();

        // 显示初始界面
        this.showScreen('start-screen');
    }

    cacheElements() {
        this.screens = {
            'start-screen': document.getElementById('start-screen'),
            'level-select-screen': document.getElementById('level-select-screen'),
            'about-screen': document.getElementById('about-screen'),
            'game-screen': document.getElementById('game-screen'),
            'pause-screen': document.getElementById('pause-screen'),
            'win-screen': document.getElementById('win-screen'),
            'gameover-screen': document.getElementById('gameover-screen')
        };

        this.elements = {
            wordArea: document.getElementById('word-area'),
            meaningArea: document.getElementById('meaning-area'),
            meaningText: document.getElementById('meaning-text'),
            score: document.getElementById('score'),
            combo: document.getElementById('combo'),
            lives: document.getElementById('lives'),
            currentLevel: document.getElementById('current-level'),
            progress: document.getElementById('progress'),
            levelGrid: document.getElementById('level-grid')
        };
    }

    bindEvents() {
        // 主菜单按钮
        document.getElementById('btn-start')?.addEventListener('click', () => this.startGame(1));
        document.getElementById('btn-levels')?.addEventListener('click', () => this.showLevelSelect());
        document.getElementById('btn-about')?.addEventListener('click', () => this.showScreen('about-screen'));

        // 返回按钮
        document.getElementById('btn-back-from-levels')?.addEventListener('click', () => this.showScreen('start-screen'));
        document.getElementById('btn-back-from-about')?.addEventListener('click', () => this.showScreen('start-screen'));

        // 游戏控制按钮
        document.getElementById('btn-pause')?.addEventListener('click', () => this.togglePause());
        document.getElementById('btn-quit')?.addEventListener('click', () => this.quitGame());
        document.getElementById('btn-sound')?.addEventListener('click', () => this.toggleSound());

        // 暂停界面按钮
        document.getElementById('btn-resume')?.addEventListener('click', () => this.togglePause());
        document.getElementById('btn-restart')?.addEventListener('click', () => this.restartGame());
        document.getElementById('btn-quit-to-menu')?.addEventListener('click', () => this.quitGame());

        // 过关界面按钮
        document.getElementById('btn-next-level')?.addEventListener('click', () => this.nextLevel());
        document.getElementById('btn-back-to-menu')?.addEventListener('click', () => this.showScreen('start-screen'));

        // 游戏结束界面按钮
        document.getElementById('btn-retry')?.addEventListener('click', () => this.restartGame());
        document.getElementById('btn-back-to-menu-from-over')?.addEventListener('click', () => this.showScreen('start-screen'));

        // 初始化碰撞检测
        this.collisionDetector.init('game-area');
        this.collisionDetector.bindEvents((result) => this.handleWordClick(result));
    }

    showScreen(screenId) {
        // 隐藏所有界面
        Object.values(this.screens).forEach(screen => {
            if (screen) screen.classList.remove('active');
        });

        // 显示目标界面
        const targetScreen = this.screens[screenId];
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenId;
        }

        // 如果显示关卡选择，更新关卡状态
        if (screenId === 'level-select-screen') {
            this.updateLevelGrid();
        }
    }

    updateLevelGrid() {
        const grid = this.elements.levelGrid;
        if (!grid) return;

        grid.innerHTML = '';

        for (let i = 1; i <= 50; i++) {
            const btn = document.createElement('button');
            btn.className = 'level-btn';
            btn.textContent = i;

            if (this.wordManager.isLevelCompleted(i)) {
                btn.classList.add('completed');
            } else if (this.wordManager.isLevelUnlocked(i)) {
                if (i <= 10) btn.classList.add('easy');
                else if (i <= 30) btn.classList.add('medium');
                else btn.classList.add('hard');
            } else {
                btn.classList.add('locked');
                btn.textContent = '🔒';
            }

            btn.addEventListener('click', () => {
                if (this.wordManager.isLevelUnlocked(i)) {
                    this.startGame(i);
                }
            });

            grid.appendChild(btn);
        }
    }

    startGame(level) {
        this.currentLevel = level;

        // 读取用户设置
        const countSelect = document.getElementById('words-per-level');
        if (countSelect) {
            this.wordManager.wordsPerLevel = parseInt(countSelect.value) || 25;
        }
        const livesSelect = document.getElementById('lives-count');
        if (livesSelect) {
            this.maxErrors = parseInt(livesSelect.value) || 4;
        }
        const speedSelect = document.getElementById('speed-setting');
        this.speedMultiplier = speedSelect ? parseFloat(speedSelect.value) || 1 : 1;

        this.wordManager.setCurrentLevel(level);

        // 重置游戏状态
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.errorCount = 0;
        this.isPaused = false;
        this.isRunning = true;
        this.activeWords = [];
        // 清理旧单词 DOM 元素
        if (this.elements.wordArea) {
            this.elements.wordArea.innerHTML = '';
        }
        this.wordSpawnTimer = 0;

        // 根据关卡设置难度参数 - 最多6个活跃单词
        this.maxActiveWords = 6;
        this.wordSpeed = (1 + (level / 50) * 0.5) * this.speedMultiplier; // 基础速度 × 用户速度倍率

        // 更新UI
        this.updateUI();
        this.showScreen('game-screen');

        // 设置第一个目标单词
        this.setNextTarget();

        // 预生成多个干扰词填充屏幕
        this.preSpawnWords();

        // 启动游戏循环
        this.lastFrameTime = performance.now();
        this.gameLoop();
    }

    // 预生成多个干扰词
    preSpawnWords() {
        // 生成足够的干扰词填满屏幕
        for (let i = 0; i < this.maxActiveWords - 1; i++) {
            setTimeout(() => {
                if (this.isRunning) {
                    this.spawnRandomWord();
                }
            }, i * 200); // 间隔200ms逐个生成
        }
    }

    // 随机生成一个单词（目标或干扰）
    spawnRandomWord() {
        // 检查目标单词是否已在屏幕上
        const isTargetOnScreen = this.targetMeaning &&
            this.activeWords.some(w => w.data.word === this.targetMeaning.word &&
                !w.element.classList.contains('hit') &&
                !w.element.classList.contains('miss'));

        if (this.targetMeaning && !isTargetOnScreen) {
            // 目标不在屏幕上，高概率立即生成（80%）
            if (Math.random() < 0.8) {
                this.spawnWordBubble(this.targetMeaning, true);
                return;
            }
        }

        // 生成干扰词
        const wordData = this.wordManager.getRandomWordExclude(this.currentLevel, this.targetMeaning?.word);
        if (wordData) {
            this.spawnWordBubble(wordData, false);
        }
    }

    spawnWordBubble(wordData, isTarget) {
        const bubble = document.createElement('div');
        bubble.className = `word-bubble ${this.wordManager.getDifficultyClass(wordData.difficulty)}`;
        bubble.textContent = wordData.word;
        bubble.dataset.word = wordData.word;
        bubble.dataset.meaning = wordData.meaning;
        bubble.dataset.difficulty = wordData.difficulty;

        // 使用不重叠的位置
        const x = this.getNonOverlappingX();
        bubble.style.left = x + 'px';
        bubble.style.top = '-100px';

        // 下落动画参数 - 10-14秒（中速下落）
        const duration = 10 + Math.random() * 4;
        bubble.style.animationDuration = duration + 's';

        this.elements.wordArea.appendChild(bubble);

        this.activeWords.push({
            element: bubble,
            data: wordData,
            y: -100,
            speed: (400 / duration) * this.wordSpeed
        });
    }

    spawnTargetWord(wordData) {
        // 检查目标单词是否已经在屏幕上
        const existingTarget = this.activeWords.find(
            w => w.data.word === wordData.word &&
            !w.element.classList.contains('hit') &&
            !w.element.classList.contains('miss')
        );
        if (existingTarget) return;

        const bubble = document.createElement('div');
        bubble.className = `word-bubble ${this.wordManager.getDifficultyClass(wordData.difficulty)}`;
        bubble.textContent = wordData.word;
        bubble.dataset.word = wordData.word;
        bubble.dataset.meaning = wordData.meaning;
        bubble.dataset.difficulty = wordData.difficulty;

        // 随机水平位置（与干扰词一样随机）
        const areaWidth = this.elements.wordArea.offsetWidth;
        const bubbleWidth = 180;
        const x = Math.random() * (areaWidth - bubbleWidth - 40) + 20;
        bubble.style.left = x + 'px';
        bubble.style.top = '-100px';

        // 下落动画参数 - 10-14秒（中速下落）
        const duration = 10 + Math.random() * 4;
        bubble.style.animationDuration = duration + 's';

        this.elements.wordArea.appendChild(bubble);

        this.activeWords.push({
            element: bubble,
            data: wordData,
            y: -100,
            speed: (400 / duration) * this.wordSpeed
        });
    }

    gameLoop(currentTime = performance.now()) {
        if (!this.isRunning || this.isPaused) return;

        const deltaTime = (currentTime - this.lastFrameTime) / 1000;
        this.lastFrameTime = currentTime;

        // 更新单词位置
        this.updateWords(deltaTime);

        // 保持屏幕上有足够的单词
        this.wordSpawnTimer += deltaTime;
        const spawnInterval = Math.max(1.0 - (this.currentLevel / 100), 0.5);
        if (this.wordSpawnTimer >= spawnInterval && this.activeWords.length < this.maxActiveWords) {
            this.spawnRandomWord();
            this.wordSpawnTimer = 0;
        }

        // 检测单词是否落地
        this.checkLandedWords();

        // 继续循环
        this.gameLoopId = requestAnimationFrame((time) => this.gameLoop(time));
    }

    spawnDistractorWord() {
        // 生成一个不是当前目标的单词
        const wordData = this.wordManager.getRandomWordExclude(this.currentLevel, this.targetMeaning?.word);
        if (!wordData) return;

        const bubble = document.createElement('div');
        bubble.className = `word-bubble ${this.wordManager.getDifficultyClass(wordData.difficulty)}`;
        bubble.textContent = wordData.word;
        bubble.dataset.word = wordData.word;
        bubble.dataset.meaning = wordData.meaning;
        bubble.dataset.difficulty = wordData.difficulty;

        // 随机位置（从顶部水平区域）
        const areaWidth = this.elements.wordArea.offsetWidth;
        const bubbleWidth = 180;
        const x = Math.random() * (areaWidth - bubbleWidth - 40) + 20;
        bubble.style.left = x + 'px';
        bubble.style.top = '-100px';

        // 下落动画参数 - 慢速下落 (12-18秒)
        const duration = 12 + Math.random() * 6;
        bubble.style.animationDuration = duration + 's';

        this.elements.wordArea.appendChild(bubble);

        this.activeWords.push({
            element: bubble,
            data: wordData,
            y: -100,
            speed: (400 / duration) * this.wordSpeed
        });
    }

    spawnWord() {
        // 如果没有目标单词，正常生成
        if (!this.targetMeaning) {
            this.spawnDistractorWord();
            return;
        }

        // 检查目标单词是否已经在屏幕上
        const existingTarget = this.activeWords.find(
            w => w.data.word === this.targetMeaning.word &&
            !w.element.classList.contains('hit') &&
            !w.element.classList.contains('miss')
        );

        // 如果目标单词不在屏幕上，先生成目标单词
        if (!existingTarget) {
            this.spawnTargetWord(this.targetMeaning);
            return;
        }

        // 否则生成干扰单词
        this.spawnDistractorWord();
    }

    updateWords(deltaTime) {
        this.activeWords.forEach((word, index) => {
            if (word.element.classList.contains('hit') || word.element.classList.contains('miss')) {
                return;
            }

            // 更新Y位置
            word.y += word.speed * deltaTime;
            word.element.style.top = word.y + 'px';
        });

        // 清理已消失的单词
        this.activeWords = this.activeWords.filter(w =>
            w.element.parentNode &&
            !w.element.classList.contains('hit') &&
            !w.element.classList.contains('miss')
        );
    }

    checkLandedWords() {
        const areaHeight = this.elements.wordArea.offsetHeight;
        const bottomLimit = areaHeight - 50;

        this.activeWords.forEach((word) => {
            if (word.y >= bottomLimit && !word.element.classList.contains('miss')) {
                word.element.classList.add('miss');
                this.soundManager.play('land');

                // 只有目标单词落地才算错误，干扰词落地直接移除
                if (word.data.word === this.targetMeaning?.word) {
                    this.handleMiss(word);
                } else {
                    // 干扰词落地，CSS 动画播放完后移除 DOM 元素
                    setTimeout(() => {
                        if (word.element && word.element.parentNode) {
                            word.element.parentNode.removeChild(word.element);
                        }
                    }, 500);
                }
            }
        });
    }

    handleWordClick(result) {
        if (!this.isRunning || this.isPaused) return;

        const { word, meaning, element, x, y } = result;

        // 防止同一元素被重复处理
        if (element.classList.contains('hit') || element.classList.contains('miss')) {
            return;
        }

        // 检查是否匹配
        if (this.targetMeaning && word === this.targetMeaning.word) {
            // 匹配正确
            this.handleCorrectMatch(element, x, y);
        } else {
            // 匹配错误
            this.handleWrongMatch(element);
        }
    }

    handleCorrectMatch(element, x, y) {
        this.combo++;
        if (this.combo > this.maxCombo) {
            this.maxCombo = this.combo;
        }

        // 计算分数（连击递增：10, 20, 30, ...）
        const score = this.combo * 10;
        this.score += score;

        // 播放音效和动画
        this.soundManager.play(this.combo > 1 ? 'combo' : 'hit');
        this.animationPlayer.createWordHitAnimation(element, () => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
        });
        this.animationPlayer.createScorePopup(x, y, score, 'positive');

        if (this.combo > 2) {
            this.animationPlayer.createComboAnimation(this.combo);
        }

        // 标记单词已使用
        this.wordManager.markWordAsUsed(this.targetMeaning.word);

        // 检查是否过关
        if (this.wordManager.isLevelComplete(this.currentLevel)) {
            this.handleLevelComplete();
        } else {
            // 设置下一个目标
            this.setNextTarget();
            // 先移除多余干扰词（直接从DOM移除，不冻结）
            this.removeExcessRandomWords();
            // 再加速剩余干扰词，让它们快速下落消失（落地不计错）
            this.accelerateDrops();
            // 立即强制生成目标单词
            this.forceSpawnTarget();
            this.updateUI();
        }
    }

    // 加速所有非目标单词的下落速度，让它们快速消失
    accelerateDrops() {
        this.activeWords.forEach(w => {
            if (!w.element.classList.contains('hit') &&
                !w.element.classList.contains('miss') &&
                w.data.word !== this.targetMeaning?.word) {
                w.speed *= 3; // 3倍速度快速下落
            }
        });
    }

    // 强制立即生成目标单词到屏幕上
    forceSpawnTarget() {
        if (!this.targetMeaning) return;
        const isOnScreen = this.activeWords.some(w =>
            w.data.word === this.targetMeaning.word &&
            !w.element.classList.contains('hit') &&
            !w.element.classList.contains('miss') &&
            w.element.parentNode
        );
        if (!isOnScreen) {
            this.spawnWordBubble(this.targetMeaning, true);
        }
    }

    handleWrongMatch(element) {
        this.combo = 0;
        this.errorCount++;
        this.score = Math.max(0, this.score - 5);

        this.soundManager.play('miss');
        this.animationPlayer.createShakeEffect(element);

        this.updateUI();

        if (this.maxErrors < 999 && this.errorCount >= this.maxErrors) {
            this.handleGameOver();
        }
    }

    handleMiss(word) {
        this.combo = 0;
        this.errorCount++;
        this.score = Math.max(0, this.score - 5);

        if (this.maxErrors < 999 && this.errorCount >= this.maxErrors) {
            this.handleGameOver();
        }

        this.updateUI();

        // 落地动画播放完后移除 DOM 元素
        setTimeout(() => {
            if (word && word.element && word.element.parentNode) {
                word.element.parentNode.removeChild(word.element);
            }
        }, 500);
    }

    handleLevelComplete() {
        this.isRunning = false;
        cancelAnimationFrame(this.gameLoopId);

        // 累计总分
        this.totalScore += this.score;

        // 保存进度
        this.wordManager.completeLevel(this.currentLevel, this.score);

        // 显示过关界面
        document.getElementById('final-score').textContent = `${this.totalScore} (本关 ${this.score})`;
        document.getElementById('max-combo').textContent = this.maxCombo;

        // 播放过关动画
        this.animationPlayer.createCelebrationAnimation();
        this.soundManager.play('levelUp');

        this.showScreen('win-screen');
    }

    handleGameOver() {
        this.isRunning = false;
        cancelAnimationFrame(this.gameLoopId);

        this.totalScore += this.score;
        document.getElementById('gameover-score').textContent = this.totalScore;
        document.getElementById('gameover-level').textContent = this.currentLevel;

        this.soundManager.play('gameOver');
        this.showScreen('gameover-screen');
    }

    nextLevel() {
        if (this.currentLevel < 50) {
            this.startGame(this.currentLevel + 1);
        } else {
            // 通关所有关卡
            this.showScreen('start-screen');
        }
    }

    restartGame() {
        this.startGame(this.currentLevel);
    }

    togglePause() {
        this.isPaused = !this.isPaused;

        if (this.isPaused) {
            cancelAnimationFrame(this.gameLoopId);
            this.showScreen('pause-screen');
        } else {
            this.lastFrameTime = performance.now();
            this.gameLoop();
            this.showScreen('game-screen');
        }
    }

    quitGame() {
        this.isRunning = false;
        cancelAnimationFrame(this.gameLoopId);
        this.showScreen('start-screen');
    }

    toggleSound() {
        const enabled = this.soundManager.toggle();
        const btn = document.getElementById('btn-sound');
        if (btn) {
            btn.textContent = enabled ? '🔊' : '🔇';
        }
    }

    updateUI() {
        if (this.elements.score) {
            this.elements.score.textContent = `总分: ${this.totalScore + this.score}`;
        }
        if (this.elements.combo) {
            this.elements.combo.textContent = `连击: x${this.combo}`;
            if (this.combo > 1) {
                this.elements.combo.classList.add('combo-pulse');
                setTimeout(() => this.elements.combo.classList.remove('combo-pulse'), 300);
            }
        }
        if (this.elements.lives) {
            if (this.maxErrors >= 999) {
                this.elements.lives.textContent = '剩余次数: ∞';
            } else {
                const remaining = this.maxErrors - this.errorCount;
                this.elements.lives.textContent = `剩余次数: ${remaining}`;
            }
        }
        if (this.elements.currentLevel) {
            this.elements.currentLevel.textContent = `关卡 ${this.currentLevel}`;
        }
        if (this.elements.progress) {
            const total = this.wordManager.wordsPerLevel;
            const current = this.wordManager.matchedWords.length;
            this.elements.progress.textContent = `${current}/${total}`;
        }
    }

    showLevelSelect() {
        this.showScreen('level-select-screen');
    }

    setNextTarget() {
        const nextWord = this.wordManager.getCurrentMeaning();
        if (nextWord) {
            this.targetMeaning = nextWord;
            if (this.elements.meaningText) {
                this.elements.meaningText.textContent = nextWord.meaning;
            }
        } else {
            // 没有更多单词了，标记关卡完成
            this.targetMeaning = null;
            if (this.elements.meaningText) {
                this.elements.meaningText.textContent = '关卡完成!';
            }
            this.handleLevelComplete();
        }
    }

    // 移除多余的干扰词，确保屏幕上有足够的空间
    removeExcessRandomWords() {
        // 获取当前活跃的非目标单词数量
        const distractorWords = this.activeWords.filter(w =>
            !w.element.classList.contains('hit') &&
            !w.element.classList.contains('miss') &&
            w.data.word !== this.targetMeaning?.word
        );

        // 如果干扰词太多，移除最老的几个（Y值最大的）
        if (distractorWords.length > 2) {
            const toRemove = distractorWords
                .sort((a, b) => b.y - a.y)
                .slice(0, distractorWords.length - 2);

            toRemove.forEach(w => {
                // 直接从 DOM 移除，避免残留冻结
                if (w.element.parentNode) {
                    w.element.parentNode.removeChild(w.element);
                }
            });
        }
    }

    // 计算不与现有单词重叠的随机位置
    getNonOverlappingX() {
        const areaWidth = this.elements.wordArea.offsetWidth;
        const bubbleWidth = 144; // 180 * 0.8
        const bubbleHeight = 80;
        const padding = 10;
        const maxAttempts = 20;

        // 收集所有现有单词的边界（只考虑在屏幕上方的）
        const occupiedBounds = this.activeWords
            .filter(w => !w.element.classList.contains('hit') && !w.element.classList.contains('miss'))
            .map(w => {
                const rect = w.element.getBoundingClientRect();
                const wordAreaRect = this.elements.wordArea.getBoundingClientRect();
                return {
                    left: rect.left - wordAreaRect.left,
                    right: rect.right - wordAreaRect.left,
                    top: rect.top - wordAreaRect.top,
                    bottom: rect.bottom - wordAreaRect.top,
                    y: w.y
                };
            });

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const x = Math.random() * (areaWidth - bubbleWidth - 40) + 20;
            const y = -100;

            // 检查与现有单词是否重叠
            let overlaps = false;
            for (const bound of occupiedBounds) {
                // 检查水平重叠（考虑水平间距）
                const horizontalOverlap = x < bound.right + padding && x + bubbleWidth > bound.left - padding;
                // 检查垂直重叠（考虑Y值相近的）
                const verticalOverlap = Math.abs(y - bound.y) < bubbleHeight + padding;

                if (horizontalOverlap && verticalOverlap) {
                    overlaps = true;
                    break;
                }
            }

            if (!overlaps) {
                return x;
            }
        }

        // 如果找不到完全不重叠的位置，返回随机位置
        return Math.random() * (areaWidth - bubbleWidth - 40) + 20;
    }
}

// 创建游戏实例
const game = new Game();

// 页面加载完成后初始化游戏
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => game.init());
} else {
    game.init();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = game;
}