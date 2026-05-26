/**
 * Collision Detection - 碰撞检测与匹配判定
 * 处理鼠标/触摸点击与单词气泡的碰撞检测
 */

class CollisionDetector {
    constructor() {
        this.gameArea = null;
        this.touchSupported = false;
        this.callback = null;
    }

    init(gameAreaId) {
        this.gameArea = document.getElementById(gameAreaId);
        this.touchSupported = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    // 检测点是否在元素范围内
    isPointInElement(x, y, element) {
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        return x >= rect.left &&
               x <= rect.right &&
               y >= rect.top &&
               y <= rect.bottom;
    }

    // 获取所有单词气泡
    getWordBubbles() {
        return document.querySelectorAll('.word-bubble');
    }

    // 检测点击事件
    handleClick(x, y, callback) {
        const bubbles = this.getWordBubbles();

        for (let i = 0; i < bubbles.length; i++) {
            const bubble = bubbles[i];

            // 跳过正在消失的动画
            if (bubble.classList.contains('hit') || bubble.classList.contains('miss')) {
                continue;
            }

            if (this.isPointInElement(x, y, bubble)) {
                console.log('Bubble clicked:', bubble.dataset.word);
                callback({
                    word: bubble.dataset.word,
                    meaning: bubble.dataset.meaning,
                    difficulty: parseInt(bubble.dataset.difficulty),
                    element: bubble,
                    x: x,
                    y: y
                });
                return true;
            }
        }
        return false;
    }

    // 处理触摸事件
    handleTouch(e, callback) {
        e.preventDefault();
        const touch = e.touches[0] || e.changedTouches[0];
        if (!touch) return false;

        return this.handleClick(touch.clientX, touch.clientY, callback);
    }

    // 绑定事件处理（事件委托，避免每个气泡单独绑定导致重复触发）
    bindEvents(callback) {
        this.callback = callback;

        if (this.touchSupported) {
            this.gameArea.addEventListener('touchstart', (e) => {
                this.handleTouch(e, callback);
            }, { passive: false });
        }

        // 只用 mousedown，不用 click，避免同一个点击触发两次回调
        this.gameArea.addEventListener('mousedown', (e) => {
            const target = e.target;
            if (target.classList && target.classList.contains('word-bubble')) {
                e.stopPropagation();
                callback({
                    word: target.dataset.word,
                    meaning: target.dataset.meaning,
                    difficulty: parseInt(target.dataset.difficulty),
                    element: target,
                    x: e.clientX,
                    y: e.clientY
                });
            }
        });
    }
}

// 全局碰撞检测器实例
const collisionDetector = new CollisionDetector();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = collisionDetector;
}