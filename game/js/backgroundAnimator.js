/**
 * Background Animator - 背景动画生成器
 * 在游戏背景中创建彩色气泡和闪光星星
 */
class BackgroundAnimator {
    constructor() {
        this.bubbleContainer = null;
        this.starContainer = null;
        this.bubbleCount = 12;
        this.starCount = 20;
        this.bubbleColors = [
            'rgba(255, 182, 193, 0.7)',   // 粉
            'rgba(173, 216, 230, 0.7)',   // 蓝
            'rgba(255, 255, 200, 0.7)',   // 黄
            'rgba(200, 255, 200, 0.7)',   // 绿
            'rgba(220, 180, 255, 0.7)'    // 紫
        ];
    }

    init() {
        // 初始化全局背景（覆盖所有界面）
        const globalBubbles = document.getElementById('global-bg-bubbles');
        const globalStars = document.getElementById('global-bg-stars');
        if (globalBubbles && globalStars) {
            this.populateContainer(globalBubbles, globalStars, 8, 14);
        }

        // 生成彩色气球
        this.createBalloons();

        // 生成草地与小花
        this.createGrass();

        // 生成小鸟与蜜蜂
        this.createFlyers();

        // 初始化游戏界面背景（更密集的动画）
        this.bubbleContainer = document.getElementById('bg-bubbles');
        this.starContainer = document.getElementById('bg-stars');
        if (this.bubbleContainer && this.starContainer) {
            this.populateContainer(this.bubbleContainer, this.starContainer, this.bubbleCount, this.starCount);
        }
    }

    createBalloons() {
        const container = document.getElementById('balloons-container');
        if (!container) return;

        const colors = [
            '#FF6B6B', '#FFA94D', '#FFD93D', '#6BCB77',
            '#4D96FF', '#9B72CB', '#F38BA0', '#FF8FAB',
            '#38BDF8', '#34D399', '#FBBF24', '#F472B6'
        ];

        // 8-10 个气球，从地面持续升向天空
        const count = 8 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            const balloon = document.createElement('div');
            balloon.className = 'balloon';
            const body = document.createElement('div');
            body.className = 'balloon-body';
            const string = document.createElement('div');
            string.className = 'balloon-string';
            balloon.appendChild(body);
            balloon.appendChild(string);

            const color = colors[i % colors.length];
            balloon.style.setProperty('--balloon-color', color);
            body.style.setProperty('--balloon-color', color);

            // 横向位置（不均匀分布）
            balloon.style.left = (2 + (i / count) * 96 + (Math.random() - 0.5) * 4) + '%';

            // 持续上升时间 12-20 秒
            const riseDur = 12 + Math.random() * 8;
            balloon.style.animationDuration = riseDur + 's';

            // 错开启动时间（让气球连续不断升空）
            balloon.style.animationDelay = -(Math.random() * riseDur) + 's';

            // 绳索摆动
            string.style.animationDuration = (2 + Math.random() * 2) + 's';
            string.style.animationDelay = -(Math.random() * 3) + 's';

            // 随机大小
            const scale = 0.7 + Math.random() * 0.7;
            balloon.style.transform = 'scale(' + scale + ')';

            container.appendChild(balloon);
        }
    }

    createGrass() {
        const container = document.getElementById('grass-container');
        if (!container) return;

        // 草丛密度：根据屏幕宽度生成
        const count = 80;
        const flowerColors = ['#FF6B9D', '#FFD93D', '#FF8C42', '#C589E8', '#FF4D6D', '#FFFFFF'];
        const grassHeights = ['tall', 'medium', 'short'];

        for (let i = 0; i < count; i++) {
            const blade = document.createElement('div');
            const heightClass = grassHeights[Math.floor(Math.random() * grassHeights.length)];
            blade.className = 'grass-blade ' + heightClass;
            blade.style.left = (i / count * 100 + Math.random() * 0.5) + '%';
            // 错开摆动节奏
            blade.style.animationDuration = (2 + Math.random() * 2) + 's';
            blade.style.animationDelay = -(Math.random() * 3) + 's';
            container.appendChild(blade);
        }

        // 散布 12 朵小花
        const flowerCount = 12;
        for (let i = 0; i < flowerCount; i++) {
            const flower = document.createElement('div');
            flower.className = 'flower';
            flower.style.left = (Math.random() * 95 + 2) + '%';
            flower.style.background = flowerColors[Math.floor(Math.random() * flowerColors.length)];
            flower.style.animationDuration = (2.5 + Math.random() * 2) + 's';
            flower.style.animationDelay = -(Math.random() * 3) + 's';
            container.appendChild(flower);
        }
    }

    createFlyers() {
        const container = document.getElementById('flyers-container');
        if (!container) return;

        // 3-4 只蜜蜂（绕小圈飞）
        const beeCount = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < beeCount; i++) {
            const bee = document.createElement('div');
            bee.className = 'bee';
            const wings = document.createElement('span');
            wings.className = 'bee-wings';
            wings.textContent = '🐝';
            bee.appendChild(wings);
            // 散布在天空
            bee.style.left = (10 + Math.random() * 75) + '%';
            bee.style.top = (15 + Math.random() * 35) + '%';
            // 各自不同的飞行周期
            bee.style.animationDuration = (3 + Math.random() * 3) + 's';
            bee.style.animationDelay = -(Math.random() * 5) + 's';
            container.appendChild(bee);
        }
    }

    populateContainer(bubbleContainer, starContainer, bubbleCount, starCount) {
        // 生成气泡
        for (let i = 0; i < bubbleCount; i++) {
            const bubble = document.createElement('div');
            bubble.className = 'bg-bubble';

            // 随机大小 8-30px
            const size = 8 + Math.random() * 22;
            bubble.style.width = size + 'px';
            bubble.style.height = size + 'px';

            // 随机水平位置
            bubble.style.left = Math.random() * 100 + '%';

            // 随机起始位置（部分从下方开始，部分已经在上升中）
            bubble.style.bottom = -(Math.random() * 100) + 'px';

            // 随机持续时间 8-20 秒
            const duration = 8 + Math.random() * 12;
            bubble.style.animationDuration = duration + 's';

            // 随机延迟（错开）
            bubble.style.animationDelay = -(Math.random() * duration) + 's';

            // 随机水平漂移
            const drift = (Math.random() - 0.5) * 100;
            bubble.style.setProperty('--drift', drift + 'px');

            // 随机颜色
            const tintIndex = Math.floor(Math.random() * 5) + 1;
            bubble.classList.add('tint-' + tintIndex);

            bubbleContainer.appendChild(bubble);
        }

        // 生成星星
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'bg-star';

            // 随机位置（仅上半屏）
            star.style.left = Math.random() * 100 + '%';
            star.style.top = (Math.random() * 70) + '%';

            // 随机大小
            const size = 2 + Math.random() * 4;
            star.style.width = size + 'px';
            star.style.height = size + 'px';

            // 随机闪烁周期
            const duration = 1.5 + Math.random() * 3;
            star.style.animationDuration = duration + 's';

            // 随机延迟
            star.style.animationDelay = -(Math.random() * duration) + 's';

            starContainer.appendChild(star);
        }
    }
}

// 全局背景动画实例
const backgroundAnimator = new BackgroundAnimator();

// 在 DOM 加载完成后立即初始化（不依赖 game.init）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => backgroundAnimator.init());
} else {
    backgroundAnimator.init();
}
