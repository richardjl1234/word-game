/**
 * Animation Player - 动画播放器
 * 使用Lottie格式播放动画效果
 */

class AnimationPlayer {
    constructor() {
        this.animations = {};
        this.container = null;
        this.loadedAnimations = {};
    }

    init(containerId) {
        this.container = document.getElementById(containerId) || document.getElementById('animation-layer');
    }

    // 创建简单的CSS动画效果（替代Lottie JSON）
    createHitEffect(x, y, type = 'hit') {
        const particleCount = type === 'combo' ? 20 : 10;
        const colors = type === 'combo'
            ? ['#FFD700', '#FFA500', '#FF6347', '#FF69B4']
            : ['#FFD700', '#FFA500', '#32CD32', '#00CED1'];

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = x + 'px';
            particle.style.top = y + 'px';
            particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            particle.style.setProperty('--drift-x', (Math.random() - 0.5) * 200 + 'px');
            particle.style.animationDuration = (0.5 + Math.random() * 0.5) + 's';

            this.container.appendChild(particle);

            setTimeout(() => {
                if (particle.parentNode) {
                    particle.parentNode.removeChild(particle);
                }
            }, 1000);
        }
    }

    // 创建分数弹出效果
    createScorePopup(x, y, score, type = 'positive') {
        const popup = document.createElement('div');
        popup.className = `score-popup ${type}`;
        popup.style.left = x + 'px';
        popup.style.top = y + 'px';
        popup.textContent = type === 'positive' ? `+${score}` : `${score}`;

        this.container.appendChild(popup);

        setTimeout(() => {
            if (popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
        }, 800);
    }

    // 烟花庆祝动画
    createFireworks(centerX, centerY) {
        const colors = ['#FF4D4D', '#FF9F40', '#FFD93D', '#6BCB77', '#4D96FF', '#9B72CB', '#F472B6'];
        const burstCount = 5;

        // 多个烟花在不同位置绽放
        for (let b = 0; b < burstCount; b++) {
            const offsetX = (Math.random() - 0.5) * 300;
            const offsetY = (Math.random() - 0.5) * 200 - 50;
            const burstX = centerX + offsetX;
            const burstY = centerY + offsetY;
            const color = colors[Math.floor(Math.random() * colors.length)];

            // 中央爆炸圆
            const burst = document.createElement('div');
            burst.className = 'firework-burst';
            burst.style.left = (burstX - 15) + 'px';
            burst.style.top = (burstY - 15) + 'px';
            burst.style.setProperty('--color', color);
            burst.style.animationDelay = (b * 0.2) + 's';
            this.container.appendChild(burst);
            setTimeout(() => burst.remove(), 1500);

            // 16 颗火花向外飞
            const sparkCount = 16;
            for (let i = 0; i < sparkCount; i++) {
                const angle = (Math.PI * 2 * i) / sparkCount;
                const distance = 60 + Math.random() * 40;
                const dx = Math.cos(angle) * distance;
                const dy = Math.sin(angle) * distance;

                const spark = document.createElement('div');
                spark.className = 'firework-spark';
                spark.style.left = burstX + 'px';
                spark.style.top = burstY + 'px';
                spark.style.setProperty('--color', color);
                spark.style.setProperty('--dx', dx + 'px');
                spark.style.setProperty('--dy', dy + 'px');
                spark.style.animationDelay = (b * 0.2 + 0.1) + 's';
                this.container.appendChild(spark);
                setTimeout(() => spark.remove(), 1500);
            }
        }
    }

    // 创建单词消除动画
    createWordHitAnimation(wordElement, callback) {
        wordElement.classList.add('hit');

        // 创建爆炸粒子效果
        const rect = wordElement.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        this.createHitEffect(x, y, 'hit');

        setTimeout(() => {
            if (callback) callback();
        }, 300);
    }

    // 创建单词落地动画
    createWordMissAnimation(wordElement, callback) {
        wordElement.classList.add('miss');

        setTimeout(() => {
            if (callback) callback();
        }, 500);
    }

    // 创建过关庆祝动画
    createCelebrationAnimation() {
        const celebrationContainer = document.createElement('div');
        celebrationContainer.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 200;
            text-align: center;
        `;

        // 创建多个庆祝粒子
        for (let i = 0; i < 30; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: absolute;
                width: ${10 + Math.random() * 20}px;
                height: ${10 + Math.random() * 20}px;
                background: ${['#FFD700', '#FF6B6B', '#4ECDC4', '#FF8E53', '#9B59B6'][Math.floor(Math.random() * 5)]};
                border-radius: 50%;
                animation: particleFloat ${1 + Math.random()}s ease-out forwards;
                left: ${(Math.random() - 0.5) * 400}px;
                top: ${(Math.random() - 0.5) * 400}px;
                --drift-x: ${(Math.random() - 0.5) * 300}px;
            `;
            celebrationContainer.appendChild(particle);
        }

        this.container.appendChild(celebrationContainer);

        setTimeout(() => {
            if (celebrationContainer.parentNode) {
                celebrationContainer.parentNode.removeChild(celebrationContainer);
            }
        }, 2000);
    }

    // 加载Lottie动画（如果可用）
    loadAnimation(name, jsonPath) {
        if (typeof lottie === 'undefined') {
            console.warn('Lottie library not loaded');
            return;
        }

        try {
            fetch(jsonPath)
                .then(response => response.json())
                .then(data => {
                    const animItem = lottie.loadAnimation({
                        container: document.createElement('div'),
                        animType: 'svg',
                        renderer: 'svg',
                        loop: false,
                        autoplay: false,
                        data: data
                    });
                    this.loadedAnimations[name] = animItem;
                });
        } catch (error) {
            console.warn('Failed to load animation:', name, error);
        }
    }

    // 播放已加载的动画
    playAnimation(name) {
        if (this.loadedAnimations[name]) {
            this.loadedAnimations[name].play();
        }
    }

    // 创建连击动画效果
    createComboAnimation(comboCount) {
        const comboText = document.createElement('div');
        comboText.className = 'score-popup combo celebration';
        comboText.style.cssText = `
            position: fixed;
            top: 30%;
            left: 50%;
            transform: translateX(-50%);
            font-size: ${1 + comboCount * 0.2}rem;
            font-weight: bold;
            color: #F39C12;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
            z-index: 100;
        `;
        comboText.textContent = `${comboCount} COMBO!`;

        document.body.appendChild(comboText);

        setTimeout(() => {
            if (comboText.parentNode) {
                comboText.parentNode.removeChild(comboText);
            }
        }, 1000);
    }

    // 创建震动效果
    createShakeEffect(element) {
        element.classList.add('shake');
        setTimeout(() => {
            element.classList.remove('shake');
        }, 400);
    }

    // 创建成功光环效果
    createSuccessGlow(element) {
        element.classList.add('success-glow');
        setTimeout(() => {
            element.classList.remove('success-glow');
        }, 600);
    }
}

// 全局动画播放器实例
const animationPlayer = new AnimationPlayer();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = animationPlayer;
}