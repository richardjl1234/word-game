// 复制此文件为 config.js 并填入你的 API 密钥
// config.js 已被 .gitignore 忽略，不会提交到仓库
//
// 此文件定义前端所需的运行时配置：
//   1) API 凭据：MiniMax TTS 接口密钥（generate_voices.py 也用同一密钥）
//   2) TTS 参数：生成语音时使用的音色、语速、音调、音量
//
// 用户可手动修改本文件，或在开始界面"语音设置"中临时调整（存 localStorage）
window.MINIMAX_CONFIG = {
  apiKey: '',
  groupId: '',
  // ★ 后端 API 地址（导入词库、上传文件等功能）
  // 自动使用浏览器当前 host 作为后端主机（同机部署 / LAN 部署都通用）；
  // 若要强制指向特定后端，可写成 'http://192.168.x.x:8765'。
  backendUrl: (() => {
    const h = (typeof window !== 'undefined' && window.location && window.location.hostname) || '127.0.0.1';
    return `http://${h}:8765`;
  })(),

  tts: {
    // MiniMax 语音模型（speech-2.8-hd 高清版）
    model: 'speech-2.8-hd',
    sampleRate: 32000,
    bitrate: 128000,
    format: 'mp3',

    // 儿童向默认值：语速慢一点、音调高一点更可爱
    defaults: {
      speed: 0.85,   // 语速（0.5 - 1.5，1.0 为标准）
      pitch: 2,      // 音调（-5 - +5，正数更高更童声）
      vol: 1.0       // 音量（0 - 1）
    },

    // 音色选择（用户选定）
    voices: {
      en: 'English_radiant_girl',                        // 英文：活泼女童
      zh: 'Chinese (Mandarin)_Warm_Bestie'               // 中文：温暖闺蜜
    }
  }
};
