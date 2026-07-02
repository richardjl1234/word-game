/**
 * GamepadController - 手柄输入处理
 * 通过 navigator.getGamepads() 轮询，支持标准游戏手柄布局（小胖2代）
 *
 * 按钮映射（Standard mapping）：
 *   0=A, 1=B, 2=X, 3=Y, 4=LB, 5=RB, 8=Select/Back, 9=Start
 *   12=DUp, 13=DDown, 14=DLeft, 15=DRight
 * 轴：0=左摇杆X, 1=左摇杆Y
 */
class GamepadController {
    constructor() {
        this.connected = false;
        this.id = '';
        this.deadzone = 0.4;          // 摇杆死区
        this.pollInterval = 50;      // 轮询间隔（ms），降低 CPU 占用
        this.lastPoll = 0;
        this.prevButtons = {};       // 上一帧按钮状态（用于边缘检测）
        this.edgePressed = {};       // 当前帧的"刚按下"状态
    }

    /**
     * 监听手柄插拔事件
     */
    init() {
        window.addEventListener('gamepadconnected', (e) => {
            this.connected = true;
            this.id = e.gamepad.id || 'Gamepad';
            this._notifyChange();
        });
        window.addEventListener('gamepaddisconnected', (e) => {
            this.connected = false;
            this.id = '';
            this.prevButtons = {};
            this.edgePressed = {};
            this._notifyChange();
        });
        // 立即检查已连接的手柄（部分浏览器不会触发 connected 事件）
        this._checkExistingGamepads();
    }

    _checkExistingGamepads() {
        if (!navigator.getGamepads) return;
        const pads = navigator.getGamepads();
        for (let i = 0; i < pads.length; i++) {
            if (pads[i]) {
                this.connected = true;
                this.id = pads[i].id || 'Gamepad';
                this._notifyChange();
                return;
            }
        }
    }

    _notifyChange() {
        const indicator = document.getElementById('gamepad-indicator');
        const name = document.getElementById('gamepad-name');
        if (indicator) {
            indicator.classList.toggle('connected', this.connected);
        }
        if (name && this.id) {
            // 显示简短的设备名
            const short = this.id.length > 18 ? this.id.substring(0, 16) + '…' : this.id;
            name.textContent = short;
        }
    }

    /**
     * 每帧调用一次，更新手柄状态。throttle 在 50ms 一次。
     */
    update() {
        const now = performance.now();
        if (now - this.lastPoll < this.pollInterval) return;
        this.lastPoll = now;

        if (!this.connected) {
            // 检查 navigator.getGamepads() 中是否已有连接但事件未触发
            const pads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (let i = 0; i < pads.length; i++) {
                if (pads[i]) {
                    this.connected = true;
                    this.id = pads[i].id || 'Gamepad';
                    this._notifyChange();
                    break;
                }
            }
            if (!this.connected) return;
        }

        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let pad = null;
        for (let i = 0; i < pads.length; i++) {
            if (pads[i]) { pad = pads[i]; break; }
        }
        if (!pad) {
            this.connected = false;
            this._notifyChange();
            return;
        }

        // 边缘检测：跟踪每个按钮的 pressed 状态变化
        const currentButtons = pad.buttons || [];
        this.edgePressed = {};
        for (let i = 0; i < currentButtons.length; i++) {
            const isPressed = currentButtons[i] && currentButtons[i].pressed;
            const wasPressed = !!this.prevButtons[i];
            if (isPressed && !wasPressed) {
                this.edgePressed[i] = true;
            }
        }
        this.prevButtons = currentButtons.map((b, i) => b && b.pressed ? i : null).filter(v => v !== null);
        // 简化：保存完整的布尔数组
        this.prevButtons = {};
        for (let i = 0; i < currentButtons.length; i++) {
            this.prevButtons[i] = !!(currentButtons[i] && currentButtons[i].pressed);
        }
    }

    _justPressed(idx) {
        // 消费式读取：返回 true 后清掉 flag，确保一次按键只触发一次
        if (this.edgePressed[idx]) {
            delete this.edgePressed[idx];
            return true;
        }
        return false;
    }

    // ====== 对外 API ======

    /** D-pad Up 刚被按下（仅一帧 true） */
    consumeDpadUp()    { return this._justPressed(12); }
    consumeDpadDown()  { return this._justPressed(13); }
    consumeDpadLeft()  { return this._justPressed(14); }
    consumeDpadRight() { return this._justPressed(15); }

    /** A 键（确认） */
    consumeConfirm()   { return this._justPressed(0); }

    /** B 键（返回/退出） */
    consumeBack()      { return this._justPressed(1); }

    /** X 键 或 Start 键（暂停） */
    consumePause()     { return this._justPressed(2) || this._justPressed(9); }

    /** Select/Back 键（返回主菜单） */
    consumeMenu()      { return this._justPressed(8); }

    /**
     * 左摇杆 X 轴（应用死区）
     * 返回 [-1, 1]，死区内返回 0
     */
    getLeftStickX() {
        if (!this.connected) return 0;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < pads.length; i++) {
            if (pads[i]) {
                const x = pads[i].axes[0] || 0;
                if (Math.abs(x) < this.deadzone) return 0;
                // 重新映射死区外到 [0, 1] 让摇杆反应更直接
                const sign = x > 0 ? 1 : -1;
                return sign * (Math.abs(x) - this.deadzone) / (1 - this.deadzone);
            }
        }
        return 0;
    }

    /**
     * 左摇杆 Y 轴（应用死区）
     * 返回 [-1, 1]，死区内返回 0
     */
    getLeftStickY() {
        if (!this.connected) return 0;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < pads.length; i++) {
            if (pads[i]) {
                const y = pads[i].axes[1] || 0;
                if (Math.abs(y) < this.deadzone) return 0;
                const sign = y > 0 ? 1 : -1;
                return sign * (Math.abs(y) - this.deadzone) / (1 - this.deadzone);
            }
        }
        return 0;
    }

    /**
     * 振动反馈
     * @param {string} type - 'miss'(短促轻震) 或 'celebrate'(庆祝强震)
     * 优先用 gamepad.vibrationActuator（Chrome 标准），降级用 navigator.vibrate
     */
    vibrate(type = 'miss') {
        if (!this.connected) return;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let pad = null;
        for (let i = 0; i < pads.length; i++) {
            if (pads[i]) { pad = pads[i]; break; }
        }
        if (!pad) return;

        // 强度配置：miss = 短促轻柔，celebrate = 长且强烈（双脉冲）
        // pulse 格式：[第一段时长, 间隔, 第二段时长]
        const config = type === 'celebrate'
            ? { duration: 200, strong: 1.0, weak: 0.9, pulse: [100, 120, 200] }
            : { duration: 80,  strong: 0.5, weak: 0.3, pulse: [80] };

        // 优先：gamepad.vibrationActuator（Chrome/Edge 标准）
        if (pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
            try {
                if (type === 'celebrate') {
                    // 庆祝：两段强震，第一段 100ms → 间隔 120ms → 第二段 200ms
                    pad.vibrationActuator.playEffect('dual-rumble', {
                        startDelay: 0, duration: config.pulse[0],
                        strongMagnitude: config.strong, weakMagnitude: config.weak
                    }).then(() => setTimeout(() => {
                        pad.vibrationActuator.playEffect('dual-rumble', {
                            startDelay: 0, duration: config.pulse[2],
                            strongMagnitude: config.strong, weakMagnitude: config.weak
                        });
                    }, config.pulse[1]));
                } else {
                    pad.vibrationActuator.playEffect('dual-rumble', {
                        startDelay: 0, duration: config.duration,
                        strongMagnitude: config.strong, weakMagnitude: config.weak
                    });
                }
                return;
            } catch (e) { /* fallthrough to navigator.vibrate */ }
        }

        // 降级：navigator.vibrate（移动端 / 部分桌面浏览器）
        // 格式：[震动, 间隔, 震动, ...]
        if (navigator.vibrate) {
            try {
                navigator.vibrate(type === 'celebrate' ? [100, 120, 200] : 80);
            } catch (e) { /* ignore */ }
        }
    }
}

// 全局单例（挂到 window，便于 game.js 访问）
window.gamepadController = new GamepadController();
