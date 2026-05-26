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
        // 从环境变量加载MiniMax配置
        this.minimaxApiKey = 'MINIMAX_API_KEY';
        this.minimaxGroupId = 'MINIMAX_GROUP_ID';

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
            click: { frequency: 660, duration: 0.05, type: 'sine' }
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