/**
 * Sound Manager - 音效管理器
 * 处理所有游戏音效的加载和播放
 */

class SoundManager {
    constructor() {
        this.sounds = {};
        this.enabled = true;
        this.audioContext = null;
        this.audioBuffers = {};
        this.minimaxApiKey = '';
        this.minimaxGroupId = '';
        this.voiceId = 'Chinese (Mandarin)_Cute_Spirit';
        this.initialized = false;
    }

    async init() {
        // 从 config.js 加载 MiniMax 配置（不提交到仓库）
        const config = window.MINIMAX_CONFIG || {};
        this.minimaxApiKey = config.apiKey || '';
        this.minimaxGroupId = config.groupId || '';

        // 初始化Web Audio API
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio API not supported:', e);
        }

        // 预加载基础音效
        this.createBaseSounds();
        this.initialized = true;
    }

    createBaseSounds() {
        // 使用Web Audio API生成基础音效
        this.sounds = {
            hit: { frequency: 880, duration: 0.1, type: 'sine' },
            miss: { frequency: 220, duration: 0.3, type: 'sawtooth' },
            land: { frequency: 110, duration: 0.4, type: 'square' },
            combo: { frequency: 1320, duration: 0.15, type: 'sine' },
            levelUp: { frequency: 1760, duration: 0.3, type: 'sine' },
            gameOver: { frequency: 165, duration: 0.8, type: 'sawtooth' },
            click: { frequency: 660, duration: 0.05, type: 'sine' },
            skip: { frequency: 440, duration: 0.2, type: 'triangle' },
            firework: { frequency: 880, duration: 0.5, type: 'sine' }
        };
    }

    play(soundName) {
        if (!this.enabled || !this.audioContext) return;

        // 恢复音频上下文（处理浏览器自动播放策略）
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        const sound = this.sounds[soundName];
        if (!sound) return;

        // 'skip' 音效：双音提示（升-降），像"叮咚"
        if (soundName === 'skip') {
            this.playSkipChime();
            return;
        }

        // 'firework' 音效：上升音 + 多组爆炸音
        if (soundName === 'firework') {
            this.playFirework();
            return;
        }

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = sound.type;
        oscillator.frequency.setValueAtTime(sound.frequency, this.audioContext.currentTime);

        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + sound.duration);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start();
        oscillator.stop(this.audioContext.currentTime + sound.duration);
    }

    playSkipChime() {
        const ctx = this.audioContext;
        const now = ctx.currentTime;

        // 两个音：上升音 + 下降音
        const tones = [
            { freq: 660, start: 0,    dur: 0.15 },
            { freq: 440, start: 0.12, dur: 0.20 }
        ];

        tones.forEach(t => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(t.freq, now + t.start);
            gain.gain.setValueAtTime(0.3, now + t.start);
            gain.gain.exponentialRampToValueAtTime(0.01, now + t.start + t.dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + t.start);
            osc.stop(now + t.start + t.dur);
        });
    }

    // 烟花庆祝音效：上升音 + 多组爆炸音
    playFirework() {
        const ctx = this.audioContext;
        const now = ctx.currentTime;

        // 1) 上升音（低频到高频）
        const launch = ctx.createOscillator();
        const launchGain = ctx.createGain();
        launch.type = 'sine';
        launch.frequency.setValueAtTime(220, now);
        launch.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
        launchGain.gain.setValueAtTime(0.0001, now);
        launchGain.gain.exponentialRampToValueAtTime(0.15, now + 0.05);
        launchGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        launch.connect(launchGain);
        launchGain.connect(ctx.destination);
        launch.start(now);
        launch.stop(now + 0.3);

        // 2) 多组爆炸音（不同时间 + 不同频率）
        const bursts = [
            { start: 0.30, freq: 1500 },
            { start: 0.40, freq: 1800 },
            { start: 0.50, freq: 2200 },
            { start: 0.65, freq: 1600 }
        ];
        bursts.forEach(b => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(b.freq, now + b.start);
            osc.frequency.exponentialRampToValueAtTime(b.freq * 0.4, now + b.start + 0.25);
            gain.gain.setValueAtTime(0.0001, now + b.start);
            gain.gain.exponentialRampToValueAtTime(0.25, now + b.start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, now + b.start + 0.3);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + b.start);
            osc.stop(now + b.start + 0.3);
        });
    }

    async playWordSound(word) {
        if (!this.enabled || !this.minimaxApiKey) {
            // 如果没有API配置，使用本地TTS
            this.playWordFallback(word);
            return;
        }

        try {
            const response = await fetch('https://api.minimax.chat/v1/t2a_v2', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.minimaxApiKey}`
                },
                body: JSON.stringify({
                    model: 'speech-2.8-hd',
                    text: word,
                    stream: false,
                    voice_id: this.voiceId,
                    group_id: this.minimaxGroupId
                })
            });

            if (response.ok) {
                const audioBlob = await response.blob();
                const audioUrl = URL.createObjectURL(audioBlob);
                const audio = new Audio(audioUrl);
                await audio.play();
                URL.revokeObjectURL(audioUrl);
            } else {
                this.playWordFallback(word);
            }
        } catch (error) {
            console.warn('TTS playback failed, using fallback:', error);
            this.playWordFallback(word);
        }
    }

    playWordFallback(word) {
        // 使用Web Speech API作为后备
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(word);
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            utterance.pitch = 1.1;
            speechSynthesis.speak(utterance);
        }
    }

    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
    }

    isEnabled() {
        return this.enabled;
    }

    // 播放带音频文件的音效
    async playSoundFile(soundPath) {
        if (!this.enabled || !this.audioContext) return;

        try {
            const response = await fetch(soundPath);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            const source = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();

            source.buffer = audioBuffer;
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            gainNode.gain.setValueAtTime(0.5, this.audioContext.currentTime);

            source.start();
        } catch (error) {
            console.warn('Sound file playback failed:', error);
        }
    }
}

// 全局音效管理器实例
const soundManager = new SoundManager();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = soundManager;
}