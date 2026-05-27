# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

英语单词闯关游戏，纯前端单页应用（HTML5 + CSS3 + Vanilla JS）。单词气泡从屏幕上方飘落，玩家将单词与底部中文释义匹配。50个关卡，2889个词汇，无构建工具/打包器。

## 开发命令

```bash
# 直接打开 index.html 即可运行（无构建步骤）
# 若需本地服务器：
python3 -m http.server 8080 -d game/
```

```bash
# 扩展词库（更新 words.json）
python3 expand_words.py

# 批量生成单词音频（需 MiniMax API）
python3 generate_audio.py
```

## 项目结构

```
game/                          # 前端游戏
├── index.html                 # 主页面（7个界面：开始/选关/说明/游戏/暂停/过关/结束）
├── css/
│   ├── style.css              # 主样式（配色、布局、按钮、气泡）
│   └── animations.css         # 关键帧动画（击中/落地/连击/粒子/庆祝）
├── js/
│   ├── game.js                # 游戏引擎核心（Game类，主循环 requestAnimationFrame）
│   ├── wordManager.js         # 词库加载、关卡进度、单词分配（localStorage持久化）
│   ├── collision.js           # 碰撞检测（鼠标/touch 事件委托）
│   ├── animationPlayer.js     # 动画特效（粒子爆炸、分数弹出、连击、震动）
│   └── soundManager.js        # 音效（Web Audio API合成 + MiniMax TTS）
├── data/
│   └── words.json             # 词库（2889 单词，按词长分50级，组内打散）
├── lib/
│   └── lottie.min.js          # Lottie 动画播放器（当前未使用）
├── expand_words.py            # 词库扩展到2889词（含英中对照表）
└── generate_audio.py          # 音频批量生成脚本（MiniMax TTS API，多线程）
```

## 架构要点

- **Game** (game.js) 是中心控制器，持有 WordManager、CollisionDetector、SoundManager、AnimationPlayer 四个模块实例
- **游戏循环**：`requestAnimationFrame` 驱动，每帧更新单词 Y 坐标，检测落地，控制生成间隔
- **碰撞检测**：事件委托监听 `mousedown` + `touchstart`，检查坐标是否在 `.word-bubble` 范围内
- **单词匹配**：底部显示当前目标中文释义，点击上方英文单词气泡进行匹配
- **词库加载**：优先从 `words.json` 异步加载，失败时降级到 `WordManager.getFallbackWords()` 内置词库
- **关卡进度**：通过 `localStorage` 键 `wordGameProgress` 持久化
- **音效**：基础音效通过 Web Audio API 合成（OscillatorNode）；单词发音优先 MiniMax TTS API，降级到 Web Speech API
- **MiniMax API 密钥**：硬编码在 `soundManager.js`、`expand_words.py`、`generate_audio.py` 中

## 难度分级

- 简单 L1-L10：3-5字母高频词
- 中等 L11-L30：5-8字母
- 较难 L31-L50：8字母+复合词

## 注意事项

- 无测试框架、无 lint 配置
- 单词气泡使用 `style.top` + `requestAnimationFrame` 手动更新位置（非 CSS animation）
- 声音文件路径为 `sounds/{word}.mp3`，目录为 `game/sounds/`
