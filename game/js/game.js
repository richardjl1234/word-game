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

        // 手柄焦点状态
        this.focusedIndex = 0;
        this.focusedButtonIndex = 0;
        this.focusableButtons = [];
        this.stickFocusTimer = 0;  // 摇杆移动冷却（防止过快切换）

        // 初始化各模块
        this.soundManager = null;
        this.animationPlayer = null;
        this.wordManager = null;
        this.collisionDetector = null;
        this.gamepadController = null;

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

        // 初始化背景动画
        if (window.backgroundAnimator) {
            window.backgroundAnimator.init();
        }

        // 加载词库
        await this.wordManager.loadWords();

        // 缓存DOM元素
        this.cacheElements();

        // 设置事件监听
        this.bindEvents();

        // 显示初始界面
        this.showScreen('start-screen');

        // 同步当前玩家显示
        this.updateCurrentPlayerDisplay();
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
        document.getElementById('btn-start')?.addEventListener('click', () => this.requestNameThenStart(1));
        document.getElementById('btn-levels')?.addEventListener('click', () => this.showLevelSelect());
        document.getElementById('btn-about')?.addEventListener('click', () => this.showScreen('about-screen'));
        document.getElementById('btn-ranking')?.addEventListener('click', () => this.showRanking());
        document.getElementById('btn-edit-name')?.addEventListener('click', async () => {
            const name = await this.promptForName({ title: '修改你的名字', defaultValue: this.getCurrentPlayer() });
            if (name) this.setCurrentPlayer(name);
        });

        // 返回按钮
        document.getElementById('btn-back-from-levels')?.addEventListener('click', () => this.showScreen('start-screen'));
        document.getElementById('btn-back-from-about')?.addEventListener('click', () => this.showScreen('start-screen'));
        document.getElementById('btn-back-from-ranking')?.addEventListener('click', () => this.showScreen('start-screen'));
        document.getElementById('btn-clear-ranking')?.addEventListener('click', () => {
            if (confirm('确定要清空排行榜吗？此操作不可撤销。')) {
                this.clearRanking();
                this.renderRanking();
            }
        });

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

        // 初始化手柄控制器
        if (window.gamepadController) {
            this.gamepadController = window.gamepadController;
            this.gamepadController.init();
            // 非游戏进行中状态都轮询手柄（菜单/暂停/过关/结束），
            // 暂停/过关/结束时 gameLoop 已被 cancelAnimationFrame 停止，必须靠这里
            this._menuPadInterval = setInterval(() => {
                if (this.currentScreen !== 'game-screen' || this.isPaused || !this.isRunning) {
                    this.pollGamepad(0);
                }
            }, 80);
        }

        // 初始化设置 stepper：同步显示 + 绑定点击 / 键盘事件
        ['words-per-level', 'lives-count', 'speed-setting'].forEach(id => {
            this.syncStepperDisplay(id);
            const stepper = document.getElementById('stepper-' + id);
            if (!stepper) return;
            stepper.querySelector('.stepper-prev')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.stepSelect(id, -1);
            });
            stepper.querySelector('.stepper-next')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.stepSelect(id, 1);
            });
            // 点击 value 区域 = 前进（步进感）
            stepper.querySelector('.stepper-value')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.stepSelect(id, 1);
            });
            // 键盘支持：方向键也能切换
            stepper.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft')  { e.preventDefault(); this.stepSelect(id, -1); }
                if (e.key === 'ArrowRight') { e.preventDefault(); this.stepSelect(id, 1); }
            });
        });

        // 初始化手柄焦点状态
        this.updateFocusableButtons();

        // 初始化语音设置面板
        this.bindVoiceSettings();
    }

    // ============================================================
    // 语音设置（开始界面折叠面板）
    // ============================================================

    static VOICE_CONFIG_KEY = 'wordGameVoiceConfig';

    /** 读取 localStorage 中的语音配置（无则用默认值） */
    loadVoiceConfig() {
        const defaults = {
            voiceEN: this.soundManager.voiceEN,
            voiceZH: this.soundManager.voiceZH,
            speed:   this.soundManager.defaults.speed,
            pitch:   this.soundManager.defaults.pitch,
            vol:     this.soundManager.defaults.vol
        };
        try {
            const saved = JSON.parse(localStorage.getItem(Game.VOICE_CONFIG_KEY) || '{}');
            return {
                voiceEN: saved.voiceEN || defaults.voiceEN,
                voiceZH: saved.voiceZH || defaults.voiceZH,
                speed:   saved.speed ?? defaults.speed,
                pitch:   saved.pitch ?? defaults.pitch,
                vol:     saved.vol   ?? defaults.vol
            };
        } catch (e) {
            return defaults;
        }
    }

    /** 绑定语音设置 UI：初始化控件 + 监听变化写回 localStorage */
    bindVoiceSettings() {
        const cfg = this.loadVoiceConfig();
        const ids = ['voice-en', 'voice-zh', 'voice-speed', 'voice-pitch', 'voice-vol'];
        const els = {};
        for (const id of ids) {
            const el = document.getElementById(id);
            if (!el) return;  // 控件尚未渲染（极早调用）
            els[id] = el;
        }
        // 写入控件
        els['voice-en'].value = cfg.voiceEN;
        els['voice-zh'].value = cfg.voiceZH;
        els['voice-speed'].value = cfg.speed;
        els['voice-pitch'].value = cfg.pitch;
        els['voice-vol'].value = cfg.vol;
        // 同步显示数值
        this._updateVoiceValueDisplay();
        // 监听
        ids.forEach(id => {
            els[id].addEventListener('change', () => {
                this._saveVoiceConfig();
                this._updateVoiceValueDisplay();
            });
            // slider 实时显示拖动值
            if (id.startsWith('voice-') && (id.endsWith('-speed') || id.endsWith('-pitch') || id.endsWith('-vol'))) {
                els[id].addEventListener('input', () => this._updateVoiceValueDisplay());
            }
        });
        // 试听按钮
        const previewBtn = document.getElementById('btn-voice-preview');
        if (previewBtn) {
            previewBtn.addEventListener('click', () => this.soundManager.previewVoiceSettings());
        }
    }

    /** 同步 slider 数值显示 */
    _updateVoiceValueDisplay() {
        const v = id => document.getElementById('val-' + id);
        const speed = document.getElementById('voice-speed');
        const pitch = document.getElementById('voice-pitch');
        const vol = document.getElementById('voice-vol');
        if (v('speed') && speed) v('speed').textContent = parseFloat(speed.value).toFixed(2);
        if (v('pitch') && pitch) {
            const n = parseInt(pitch.value);
            v('pitch').textContent = (n >= 0 ? '+' : '') + n;
        }
        if (v('vol') && vol) v('vol').textContent = Math.round(parseFloat(vol.value) * 100) + '%';
    }

    /** 把当前控件值写回 localStorage（同时同步到 soundManager） */
    _saveVoiceConfig() {
        const cfg = {
            voiceEN: document.getElementById('voice-en').value,
            voiceZH: document.getElementById('voice-zh').value,
            speed:   parseFloat(document.getElementById('voice-speed').value),
            pitch:   parseInt(document.getElementById('voice-pitch').value),
            vol:     parseFloat(document.getElementById('voice-vol').value)
        };
        try {
            localStorage.setItem(Game.VOICE_CONFIG_KEY, JSON.stringify(cfg));
        } catch (e) {}
        // 同步到 soundManager（不立即影响已加载 mp3，需重生成才生效）
        this.soundManager.voiceEN = cfg.voiceEN;
        this.soundManager.voiceZH = cfg.voiceZH;
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

        // 切换屏幕时刷新可聚焦按钮列表
        setTimeout(() => this.updateFocusableButtons(), 0);
    }

    // 在屏幕中央显示一条临时消息（毫秒后自动消失）
    showMessage(text, duration = 1200) {
        const layer = document.getElementById('animation-layer');
        if (!layer) return;
        const msg = document.createElement('div');
        msg.className = 'game-message';
        msg.textContent = text;
        msg.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.5);
            padding: 16px 32px;
            background: rgba(0, 0, 0, 0.75);
            color: #FFD93D;
            font-size: 1.8rem;
            font-weight: 700;
            border-radius: 16px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
            z-index: 200;
            opacity: 0;
            pointer-events: none;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
            animation: gameMessageAnim 1.2s ease-out forwards;
        `;
        layer.appendChild(msg);
        setTimeout(() => msg.remove(), duration + 100);
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
                    this.requestNameThenStart(i);
                }
            });

            grid.appendChild(btn);
        }

        // 渲染"错词复习"特殊关卡
        this.renderMissedLevelButton();
    }

    renderMissedLevelButton() {
        const container = document.getElementById('level-special-row');
        if (!container) return;

        const missedCount = this.wordManager.getMissedWordsCount();
        container.innerHTML = '';

        const btn = document.createElement('button');
        btn.className = 'level-special-btn';
        if (missedCount > 0) {
            btn.innerHTML = `📚 错词复习<br><span class="special-count">${missedCount} 个待复习</span>`;
            btn.classList.add('has-missed');
            btn.addEventListener('click', () => this.requestNameThenStart('missed'));
        } else {
            btn.innerHTML = `📚 错词复习<br><span class="special-count">暂无错词</span>`;
            btn.disabled = true;
        }
        container.appendChild(btn);
    }

    /**
     * 在 startGame 之前确认玩家姓名：没有则弹 modal 强制输入。
     * 已设置则直接开始游戏（不打扰玩家）。
     */
    async requestNameThenStart(level) {
        let name = this.getCurrentPlayer();
        if (!name) {
            name = await this.promptForName({ title: '欢迎！请输入你的名字' });
            if (!name) return;  // 用户取消
            this.setCurrentPlayer(name);
        }
        this.startGame(level);
    }

    startGame(level) {
        this.currentLevel = level;
        this.isMissedLevel = (level === 'missed');

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

        // ★ 新增：预加载本关所有单词的 mp3（不阻塞）
        this.soundManager.preloadLevelWords(this.wordManager.currentLevelWords);

        // 重置游戏状态
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.errorCount = 0;
        this.wrongClickStreak = 0;  // 累进扣分计数器
        this.isPaused = false;
        this.isRunning = true;
        this.activeWords = [];
        // 清理旧单词 DOM 元素
        if (this.elements.wordArea) {
            this.elements.wordArea.innerHTML = '';
        }
        this.wordSpawnTimer = 0;

        // 根据关卡设置难度参数
        // 错题关卡：需要更多干扰词来强化记忆，普通关卡按 level 递增
        if (this.isMissedLevel) {
            this.maxActiveWords = 12;
        } else {
            this.maxActiveWords = 6;
        }
        // 错词关卡用中等速度，普通关卡按 level 递增
        const baseLevel = this.isMissedLevel ? 20 : (typeof level === 'number' ? level : 1);
        this.wordSpeed = (1 + (baseLevel / 50) * 0.5) * this.speedMultiplier;

        // 更新UI
        this.updateUI();
        this.showScreen('game-screen');

        // 设置第一个目标单词
        this.setNextTarget();

        // 预生成多个干扰词填充屏幕
        this.preSpawnWords();

        // 重置手柄焦点（preSpawnWords 末尾会随机选定焦点，无需提前 applyWordFocus）
        this.focusedIndex = 0;
        this.focusedButtonIndex = 0;

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
        // 单词预生成完成后，随机选一个作为焦点（避免总是落在 target 上）
        setTimeout(() => this.refocusRandom(), this.maxActiveWords * 200 + 50);
    }

    // 随机生成一个单词（目标或干扰）
    spawnRandomWord() {
        // 检查目标单词是否已在屏幕上
        const isTargetOnScreen = this.targetMeaning &&
            this.activeWords.some(w => w.data.word === this.targetMeaning.word &&
                !w.element.classList.contains('hit') &&
                !w.element.classList.contains('miss') &&
                !w.element.classList.contains('wrong'));

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
            !w.element.classList.contains('miss') &&
            !w.element.classList.contains('wrong')
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
        // 错题关卡用较快刷新频率（单词掉落快，需要更频繁补位）
        let spawnInterval;
        if (this.isMissedLevel) {
            spawnInterval = 0.8;  // 错题关卡：每 0.8s 补一个
        } else {
            spawnInterval = Math.max(1.0 - (this.currentLevel / 100), 0.5);
        }
        if (this.wordSpawnTimer >= spawnInterval && this.activeWords.length < this.maxActiveWords) {
            this.spawnRandomWord();
            this.wordSpawnTimer = 0;
        }

        // 检测单词是否落地
        this.checkLandedWords();

        // 轮询手柄输入
        this.pollGamepad(deltaTime);

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
            !w.element.classList.contains('miss') &&
            !w.element.classList.contains('wrong')
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
            if (word.element.classList.contains('hit') || word.element.classList.contains('miss') || word.element.classList.contains('wrong')) {
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
            !w.element.classList.contains('miss') &&
            !w.element.classList.contains('wrong')
        );

        // 维护手柄焦点：如果当前聚焦的单词已消失，重置到 0
        const alive = this.aliveWordBubbles();
        if (this.focusedIndex >= alive.length) {
            this.focusedIndex = 0;
            this.applyWordFocus();
        }
    }

    checkLandedWords() {
        const areaHeight = this.elements.wordArea.offsetHeight;
        const bottomLimit = areaHeight - 50;

        this.activeWords.forEach((word) => {
            if (word.y >= bottomLimit && !word.element.classList.contains('miss') && !word.element.classList.contains('wrong')) {
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
        if (element.classList.contains('hit') || element.classList.contains('miss') || element.classList.contains('wrong')) {
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
        // 答对 → 重置连续点错计数（累进扣分重新从 -10 起算）
        this.wrongClickStreak = 0;

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

        // 错词关卡中，累计 3 次正确后才从错词本中移除
        if (this.isMissedLevel) {
            const result = this.wordManager.markMissedWordProgress(this.targetMeaning.word, 3);
            if (result.mastered) {
                // 达到 3 次，播放庆祝音效与烟花
                this.soundManager.play('firework');
                this.animationPlayer.createFireworks?.(x, y);
                // 手柄振动反馈：错词掌握 → 双脉冲强震
                if (this.gamepadController) {
                    this.gamepadController.vibrate('celebrate');
                }
                this.showMessage('🎉 已掌握！', 1500);
            } else {
                // 显示进度 (1/3, 2/3)
                this.showMessage(`✦ 进度 ${result.hits}/${result.required}`, 800);
            }
            // 错题关卡中不调用 markWordAsUsed（错词本中的词每个要重复 3 次）
        } else {
            // 普通关卡：标记单词已使用
            this.wordManager.markWordAsUsed(this.targetMeaning.word);
        }

        // ★ 答对序列：播英文 1 次 → 等 0.5s → 切下一个目标（setNextTarget 内会播下一个中文）
        const afterEnglishCallback = this.wordManager.isLevelComplete(this.currentLevel)
            ? () => this.handleLevelComplete()
            : () => this.advanceToNextTarget();
        this.soundManager.playEnglishThenCallback(this.targetMeaning, 700, afterEnglishCallback);
    }

    /** 切换到下一个目标（在英文播完 + 0.5s 间隔后被调用） */
    advanceToNextTarget() {
        if (!this.isRunning) return;
        // 设置下一个目标
        this.setNextTarget();
        // 先移除多余干扰词（直接从DOM移除，不冻结）
        this.removeExcessRandomWords();
        // 再加速剩余干扰词，让它们快速下落消失（落地不计错）
        this.accelerateDrops();
        // 立即强制生成目标单词
        this.forceSpawnTarget();
        this.updateUI();
        // 重新校准手柄焦点到新目标单词（避免前一个聚焦的单词被清除后无单词高亮）
        this.refocusRandom();
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
        // 累进扣分：连续点错 → 第 1 次 -10，第 2 次 -20，第 3 次 -30 ...
        // 答对一次后清零（handleCorrectMatch 中重置 wrongClickStreak）
        this.wrongClickStreak = (this.wrongClickStreak || 0) + 1;
        const penalty = 10 * this.wrongClickStreak;
        this.score = Math.max(0, this.score - penalty);

        // 标记 .wrong 让 CSS 触发爆炸消失动画
        if (element) element.classList.add('wrong');

        // 在单词位置触发爆炸粒子效果
        if (element) {
            const rect = element.getBoundingClientRect();
            this.animationPlayer.createHitEffect(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                'wrong'
            );
        }
        this.soundManager.play('miss');
        this.animationPlayer.createShakeEffect(element);

        // 弹出扣分提示（红色 -N）
        if (element) {
            const rect = element.getBoundingClientRect();
            this.animationPlayer.createScorePopup(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                `-${penalty}`,
                'negative'
            );
        }

        // 手柄振动反馈：错误点击 → 与错过同强度
        if (this.gamepadController) {
            this.gamepadController.vibrate('miss');
        }

        this.updateUI();

        // 动画结束后从 activeWords 中移除并删除 DOM
        if (element) {
            setTimeout(() => {
                if (element.parentNode) element.parentNode.removeChild(element);
                // DOM 移除后重新校准焦点：选错的单词消失，需要重新定位到目标单词
                this.refocusRandom();
            }, 500);
        }

        if (this.maxErrors < 999 && this.errorCount >= this.maxErrors) {
            this.handleGameOver();
        } else {
            // 即使 DOM 还没移除，先重新校准焦点（focusedIndex 可能指向被标记 wrong 的单词）
            this.refocusRandom();
        }
    }

    handleMiss(word) {
        this.combo = 0;
        this.errorCount++;
        this.score = Math.max(0, this.score - 5);
        // 单词落地也重置连续点错计数（不同错误类型不应叠加）
        this.wrongClickStreak = 0;

        // 手柄振动反馈：单词错过 → 短促轻震
        if (this.gamepadController) {
            this.gamepadController.vibrate('miss');
        }

        // 仅当目标词落地时，计入"目标词错过次数"
        let shouldSkipTarget = false;
        if (word && word.data && this.targetMeaning &&
            word.data.word === this.targetMeaning.word) {
            shouldSkipTarget = this.wordManager.recordTargetMiss(word.data.word);

            if (shouldSkipTarget) {
                // 标记为错词，加入错词本
                this.wordManager.saveMissedWord(word.data);
                // 播放特殊的"跳过"音效
                this.soundManager.play('skip');
                this.animationPlayer.createScorePopup(
                    word.element.getBoundingClientRect().left + 80,
                    word.element.getBoundingClientRect().top,
                    '跳过！',
                    'negative'
                );
                // 切换到下一个目标
                setTimeout(() => {
                    this.setNextTarget();
                    this.removeExcessRandomWords();
                    this.accelerateDrops();
                    this.forceSpawnTarget();
                    this.updateUI();
                    // 重新校准手柄焦点到新目标单词
                    this.refocusRandom();
                }, 600);
            }
        }

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

        // 保存排行榜记录
        this.saveRankingEntry({
            name:  this.getCurrentPlayer() || '匿名',
            score: this.totalScore,
            level: this.currentLevel,
            date:  new Date().toISOString()
        });

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

        // 保存排行榜记录（即使游戏失败也记录）
        this.saveRankingEntry({
            name:  this.getCurrentPlayer() || '匿名',
            score: this.totalScore,
            level: this.currentLevel,
            date:  new Date().toISOString()
        });

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

    // ====== 手柄支持 ======

    pollGamepad(deltaTime) {
        if (!this.gamepadController) return;
        this.gamepadController.update();

        // 全局通用：A 键、Start/X 键、Select 键 在所有界面都生效
        if (this.gamepadController.consumeConfirm()) {
            this.handleGamepadConfirm();
        }
        if (this.gamepadController.consumePause()) {
            if (this.currentScreen === 'game-screen') this.togglePause();
        }
        if (this.gamepadController.consumeMenu()) {
            if (this.currentScreen === 'game-screen') this.quitGame();
            else if (this.currentScreen === 'level-select-screen' || this.currentScreen === 'about-screen') this.showScreen('start-screen');
        }
        if (this.gamepadController.consumeBack()) {
            // B 键：游戏内退出，菜单中返回
            if (this.currentScreen === 'game-screen') this.quitGame();
            else if (this.currentScreen === 'level-select-screen' || this.currentScreen === 'about-screen') this.showScreen('start-screen');
            else if (this.currentScreen === 'pause-screen') this.togglePause();  // 退出暂停
        }

        // 游戏中：单词焦点导航
        if (this.currentScreen === 'game-screen' && this.isRunning && !this.isPaused) {
            let dir = 0;
            if (this.gamepadController.consumeDpadLeft()) dir = -1;
            if (this.gamepadController.consumeDpadRight()) dir = 1;
            if (dir !== 0) {
                this.cycleWordFocus(dir);
                this.stickFocusTimer = 0.3;  // 摇杆移动冷却 300ms
            } else {
                // 左摇杆连续移动（snap 到最近单词）
                this.stickFocusTimer = Math.max(0, this.stickFocusTimer - deltaTime);
                if (this.stickFocusTimer === 0) {
                    const stickX = this.gamepadController.getLeftStickX();
                    if (Math.abs(stickX) > 0.3) {
                        this.snapFocusByStick(stickX);
                        this.stickFocusTimer = 0.18;
                    }
                }
            }
        } else if (this.focusableButtons.length > 0) {
            // 菜单界面：按钮焦点导航
            const focused = this.focusableButtons[this.focusedButtonIndex];
            const focusedIsStepper = this.isStepper(focused);

            // stepper 焦点：D-pad Left/Right 改值；Up/Down 移动焦点
            let dir = 0;
            if (focusedIsStepper) {
                if (this.gamepadController.consumeDpadLeft())  this.stepSelect(focused.dataset.target, -1);
                if (this.gamepadController.consumeDpadRight()) this.stepSelect(focused.dataset.target, 1);
                if (this.gamepadController.consumeDpadUp())    dir = -this.currentRowSize();
                if (this.gamepadController.consumeDpadDown())  dir = this.currentRowSize();
            } else {
                if (this.gamepadController.consumeDpadLeft())  dir = -1;
                if (this.gamepadController.consumeDpadRight()) dir = 1;
                if (this.gamepadController.consumeDpadUp())    dir = -this.currentRowSize();
                if (this.gamepadController.consumeDpadDown())  dir = this.currentRowSize();
            }
            if (dir !== 0) this.cycleButtonFocus(dir);
        }
    }

    currentRowSize() {
        // 关卡选择界面：10 列布局
        if (this.currentScreen === 'level-select-screen') return 10;
        // 其余界面：竖向排列，按 1 个切换
        return 1;
    }

    handleGamepadConfirm() {
        if (this.currentScreen === 'game-screen' && this.isRunning && !this.isPaused) {
            this.selectFocusedWord();
        } else {
            // 菜单：stepper → 前进一档；按钮 → 点击
            const focused = this.focusableButtons[this.focusedButtonIndex];
            if (!focused) return;
            if (this.isStepper(focused)) {
                this.stepSelect(focused.dataset.target, 1);
            } else {
                focused.click();
            }
        }
    }

    /** 游戏中：A 键选择当前聚焦单词 */
    selectFocusedWord() {
        const alive = this.aliveWordBubbles();
        if (alive.length === 0) return;
        // 修正 focusedIndex 到有效范围
        if (this.focusedIndex >= alive.length) this.focusedIndex = 0;
        const target = alive[this.focusedIndex];
        if (!target) return;
        const rect = target.element.getBoundingClientRect();
        const result = {
            word: target.data.word,
            meaning: target.data.meaning,
            difficulty: target.data.difficulty,
            element: target.element,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        this.handleWordClick(result);
    }

    /** D-pad 左右：在 alive 单词列表中循环切换焦点 */
    cycleWordFocus(direction) {
        const alive = this.aliveWordBubbles();
        if (alive.length === 0) {
            this.focusedIndex = 0;
            return;
        }
        this.focusedIndex = (this.focusedIndex + direction + alive.length) % alive.length;
        this.applyWordFocus();
    }

    /** 摇杆：snap 到最接近当前 X 方向 + 摇杆方向的 alive 单词 */
    snapFocusByStick(stickX) {
        const alive = this.aliveWordBubbles();
        if (alive.length === 0) return;
        const current = alive[this.focusedIndex] || alive[0];
        const currentRect = current.element.getBoundingClientRect();
        const currentX = currentRect.left + currentRect.width / 2;
        const areaWidth = this.elements.wordArea.offsetWidth || window.innerWidth;
        const targetX = currentX + stickX * areaWidth * 0.5;

        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < alive.length; i++) {
            const r = alive[i].element.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const d = Math.abs(cx - targetX);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        if (best !== this.focusedIndex) {
            this.focusedIndex = best;
            this.applyWordFocus();
        }
    }

    applyWordFocus() {
        // 清除所有 .focused，再添加到当前活跃单词
        this.activeWords.forEach(w => w.element.classList.remove('focused'));
        const alive = this.aliveWordBubbles();
        if (alive[this.focusedIndex]) {
            alive[this.focusedIndex].element.classList.add('focused');
        }
    }

    /**
     * 单词列表变化后，随机选一个 alive 单词重新聚焦。
     *
     * 关键设计：聚焦必须指向**随机候选**，不能自动指向 targetMeaning，
     * 否则手柄玩家只要一直按 A 就能答对，丧失挑战性。玩家必须用 D-pad
     * 导航到正确的目标单词。
     *
     * 用于：handleCorrectMatch / handleWrongMatch / handleMiss 之后。
     */
    refocusRandom() {
        const alive = this.aliveWordBubbles();
        if (alive.length === 0) {
            this.focusedIndex = 0;
            return;
        }
        // 随机选一个 alive 单词作为新的焦点（不能选刚消失的或刚被标记 hit/wrong 的）
        this.focusedIndex = Math.floor(Math.random() * alive.length);
        this.applyWordFocus();
    }

    aliveWordBubbles() {
        return this.activeWords.filter(w =>
            w.element.parentNode &&
            !w.element.classList.contains('hit') &&
            !w.element.classList.contains('miss') &&
            !w.element.classList.contains('wrong')
        );
    }

    /** 收集当前屏幕的可聚焦按钮 */
    updateFocusableButtons() {
        let selector = '';
        switch (this.currentScreen) {
            case 'start-screen':
                selector = '#start-screen .setting-stepper, #start-screen .btn-primary, #start-screen .btn-secondary, #start-screen .btn-edit-name';
                break;
            case 'ranking-screen':
                selector = '#ranking-screen .btn-back, #ranking-screen .btn-clear-ranking';
                break;
            case 'level-select-screen':
                selector = '#level-select-screen .level-btn:not(.locked), #level-select-screen .level-special-btn, #level-select-screen .btn-back';
                break;
            case 'about-screen':
                selector = '#about-screen .btn-back';
                break;
            case 'pause-screen':
                selector = '#pause-screen .btn-primary, #pause-screen .btn-secondary';
                break;
            case 'win-screen':
                selector = '#win-screen .btn-primary, #win-screen .btn-secondary';
                break;
            case 'gameover-screen':
                selector = '#gameover-screen .btn-primary, #gameover-screen .btn-secondary';
                break;
            default:
                this.focusableButtons = [];
                this.focusedButtonIndex = 0;
                return;
        }
        const btns = Array.from(document.querySelectorAll(selector))
            .filter(b => b.offsetParent !== null);  // 只保留可见按钮
        this.focusableButtons = btns;
        if (this.focusedButtonIndex >= btns.length) this.focusedButtonIndex = 0;
        this.applyButtonFocus();
    }

    applyButtonFocus() {
        this.focusableButtons.forEach((b, i) => b.classList.toggle('focused', i === this.focusedButtonIndex));
    }

    cycleButtonFocus(direction) {
        if (this.focusableButtons.length === 0) return;
        this.focusedButtonIndex = (this.focusedButtonIndex + direction + this.focusableButtons.length) % this.focusableButtons.length;
        this.applyButtonFocus();
    }

    // ====== Setting Stepper（手柄可聚焦设置控件）======

    /** 判断元素是否是设置 stepper */
    isStepper(el) {
        return el && el.classList && el.classList.contains('setting-stepper');
    }

    /** 修改 select 的 selectedIndex（带 wrap-around），并同步显示文本 */
    stepSelect(selectId, delta) {
        const select = document.getElementById(selectId);
        if (!select) return;
        const n = select.options.length;
        const idx = (select.selectedIndex + delta + n) % n;
        select.selectedIndex = idx;
        this.syncStepperDisplay(selectId);
    }

    /** 读取 select 当前选中项的文本，写入对应的 .stepper-value 元素 */
    syncStepperDisplay(selectId) {
        const display = document.getElementById('display-' + selectId);
        const select = document.getElementById(selectId);
        if (display && select && select.options[select.selectedIndex]) {
            display.textContent = select.options[select.selectedIndex].textContent;
        }
    }

    // ====== 玩家姓名 & 排行榜 ======

    /** localStorage 键名 */
    static STORAGE_KEYS = {
        ranking: 'wordGameRanking',
        player:  'wordGameCurrentPlayer'
    };

    /** 排行榜容量 */
    static RANKING_MAX = 10;

    /** 读取排行榜（按 score 降序） */
    loadRanking() {
        try {
            const raw = localStorage.getItem(Game.STORAGE_KEYS.ranking);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    /** 保存一条排行榜记录，并裁剪到 RANKING_MAX */
    saveRankingEntry(entry) {
        const list = this.loadRanking();
        list.push({
            name:   entry.name   || '匿名',
            score:  Number(entry.score)  || 0,
            level:  Number(entry.level)  || 1,
            date:   entry.date   || new Date().toISOString()
        });
        list.sort((a, b) => b.score - a.score);
        const top = list.slice(0, Game.RANKING_MAX);
        try {
            localStorage.setItem(Game.STORAGE_KEYS.ranking, JSON.stringify(top));
        } catch (e) {
            console.warn('localStorage save failed:', e);
        }
        return top;
    }

    /** 清空排行榜 */
    clearRanking() {
        try {
            localStorage.removeItem(Game.STORAGE_KEYS.ranking);
        } catch (e) {}
    }

    /** 读取当前玩家名（可能为空字符串） */
    getCurrentPlayer() {
        try {
            return localStorage.getItem(Game.STORAGE_KEYS.player) || '';
        } catch (e) {
            return '';
        }
    }

    /** 设置当前玩家名 */
    setCurrentPlayer(name) {
        const trimmed = String(name || '').trim().slice(0, 20);
        try {
            if (trimmed) {
                localStorage.setItem(Game.STORAGE_KEYS.player, trimmed);
            } else {
                localStorage.removeItem(Game.STORAGE_KEYS.player);
            }
        } catch (e) {}
        this.updateCurrentPlayerDisplay();
    }

    /** 更新开始界面"当前玩家"显示 */
    updateCurrentPlayerDisplay() {
        const el = document.getElementById('current-player-name');
        if (!el) return;
        const name = this.getCurrentPlayer();
        el.textContent = name || '未设置';
    }

    /**
     * 弹出姓名输入 modal，返回 Promise<string>。
     * 用户输入名字并确定后 resolve(name)；点取消或关闭 resolve(null)。
     */
    promptForName({ title = '请输入你的名字', defaultValue = '', requireNonEmpty = true } = {}) {
        return new Promise((resolve) => {
            const modal   = document.getElementById('name-input-modal');
            const titleEl = document.getElementById('name-modal-title');
            const input   = document.getElementById('player-name-input');
            const confirm = document.getElementById('btn-confirm-name');
            const cancel  = document.getElementById('btn-cancel-name');

            if (!modal || !input || !confirm || !cancel) {
                resolve(null);
                return;
            }

            titleEl.textContent = title;
            input.value = defaultValue || this.getCurrentPlayer() || '';
            input.classList.remove('input-error');
            modal.classList.add('active');
            // 等下一帧让 input 拿到焦点（动画结束）
            setTimeout(() => { input.focus(); input.select(); }, 50);

            const cleanup = () => {
                modal.classList.remove('active');
                confirm.removeEventListener('click', onConfirm);
                cancel.removeEventListener('click', onCancel);
                input.removeEventListener('keydown', onKey);
                modal.removeEventListener('click', onBackdrop);
            };

            const onConfirm = () => {
                const name = input.value.trim().slice(0, 20);
                if (requireNonEmpty && !name) {
                    input.classList.add('input-error');
                    setTimeout(() => input.classList.remove('input-error'), 400);
                    return;
                }
                cleanup();
                resolve(name || null);
            };
            const onCancel = () => { cleanup(); resolve(null); };
            const onKey = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
                if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            };
            const onBackdrop = (e) => { if (e.target === modal) onCancel(); };

            confirm.addEventListener('click', onConfirm);
            cancel.addEventListener('click', onCancel);
            input.addEventListener('keydown', onKey);
            modal.addEventListener('click', onBackdrop);
        });
    }

    /** 渲染排行榜屏幕 */
    renderRanking() {
        const list = this.loadRanking();
        const container = document.getElementById('ranking-list');
        if (!container) return;
        container.innerHTML = '';

        if (list.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ranking-entry empty';
            empty.textContent = '暂无记录，去玩一局吧！';
            container.appendChild(empty);
            return;
        }

        list.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.className = 'ranking-entry';
            const rankCls = idx < 3 ? `rank-${idx + 1}` : 'rank-other';
            // 格式化日期 YYYY-MM-DD
            let dateStr = '';
            try {
                const d = new Date(entry.date);
                if (!isNaN(d.getTime())) {
                    dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                }
            } catch (e) {}
            row.innerHTML = `
                <span class="rank ${rankCls}">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}</span>
                <span class="player-name">${this._escapeHtml(entry.name)}</span>
                <span class="player-score">${entry.score}</span>
                <span class="player-date">${dateStr}</span>
            `;
            container.appendChild(row);
        });
    }

    /** 显示排行榜屏幕 */
    showRanking() {
        this.renderRanking();
        this.showScreen('ranking-screen');
    }

    /** HTML 转义（防 XSS，玩家名可能含特殊字符） */
    _escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
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
            if (this.isMissedLevel) {
                this.elements.currentLevel.textContent = '📚 错词复习';
            } else {
                this.elements.currentLevel.textContent = `关卡 ${this.currentLevel}`;
            }
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
            // ★ 新增：播放中文释义（不阻塞 UI 更新）
            this.soundManager.playChineseMeaning(nextWord.meaning, nextWord);
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
// 暴露到 window 方便控制台调试和 E2E 测试
window.game = game;

// 页面加载完成后初始化游戏
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => game.init());
} else {
    game.init();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = game;
}