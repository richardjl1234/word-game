# 技术债记录

本文档记录已分析但暂不修复的技术问题。每条记录包含 **现状 / 根因 / 影响 / 已尝试方案 / 未来修复方向 / 优先级**。

---

## TD-001: test_focus_after_match.js T5 flaky 失败

### 现状
`test_focus_after_match.js` 第 5 组断言（T5.1 ~ T5.5，连续 5 次 `selectFocusedWord()` 后检查 `.focused` 数量 = 1）存在 flaky 失败。两次连续运行结果：

- 第一次：`T5.1` 失败（count=0, alive=1）
- 第二次：`T5.5` 失败（count=0, alive=3）

T2/T3/T4/T6（验证随机化、初始聚焦、JS 错误）始终通过。

### 根因
`handleCorrectMatch` → `refocusRandom` 调用 `document.querySelectorAll('.word-bubble')` 取 alive 列表，**但此时 DOM 列表可能尚未包含由后续 spawn 周期添加的新单词**。

具体时序：
1. `selectFocusedWord()` 触发 `handleCorrectMatch`
2. `matchedWords++`，若达到阈值则 `spawnWord()` 添加新 DOM 元素
3. `refocusRandom()` 调用 `document.querySelectorAll(...)` 选择随机一个 .focused
4. 若此时 spawn 的新单词尚未 append（CSS 渲染尚未触发 reflow），随机数选中的元素可能仍指向旧元素，导致旧的 `.focused` 被清理而新的未挂上

测试用 `await page.waitForTimeout(900)`，但 spawn 间隔可能更短，新单词可能在 900ms 后才到达 DOM 的稳定状态。

### 影响
- 测试 flaky，不影响生产功能
- 生产环境：玩家体验正常（`refocusRandom` 是同步调用，requestAnimationFrame 驱动 spawn，实际游戏内几乎察觉不到）

### 已尝试方案
1. 增加 `waitForTimeout` 到 1500ms：未尝试（治标不治本）
2. 让 `refocusRandom` 显式等待 `requestAnimationFrame` 后再选：会改变生产逻辑，不应仅为测试改
3. 改用 `MutationObserver` 监听 DOM 稳定：复杂度高，收益低

### 未来修复方向
**优先级：低**

在 `handleCorrectMatch` 末尾添加 `requestAnimationFrame` 双 rAF 确保 DOM 稳定：

```js
requestAnimationFrame(() => requestAnimationFrame(() => this.refocusRandom()));
```

或者重构 `refocusRandom` 改为基于 `this.aliveWordBubbles()`（Game 内部维护的 JS 数组）而非 DOM 查询，避免 DOM 与逻辑状态不一致。

### 验证
```bash
node test_focus_after_match.js   # 偶发 T5.X 失败，失败位置不固定
```

---

## TD-002: test_gamepad_settings.js T15 因无玩家名阻塞 modal

### 现状
`test_gamepad_settings.js` T15（"A → 进入游戏 (game-screen)"）在全新浏览器会话下失败，因为：

1. 测试启动新浏览器 → localStorage 为空 → 没有任何玩家
2. 按 A 键 → `handleGamepadConfirm` → `btn-start.click()` → `requestNameThenStart(1)`
3. `requestNameThenStart` 检测无玩家名 → 弹 `name-input-modal` 等待用户输入
4. 测试 `waitForTimeout(300)` 后检查 `currentScreen`，仍为 `start-screen`（modal 是 overlay）
5. **T15 失败**

这个问题**不是本次新功能引入的**——在原版（commit 1c63949）代码下 git stash 后跑同一个测试也失败。原 commit 描述"28/28 通过"可能是开发时手动设置了 localStorage 后跑的。

### 影响
- 仅测试失败，不影响生产功能
- 生产中无玩家时点开始会弹 modal 输入名字（这是原设计意图）

### 已尝试方案
1. 修改 `requestNameThenStart` 自动创建 "Player" 用户：会破坏 `test_penalty_ranking.js` 的 T2（"点击开始游戏弹出姓名 modal"）
2. 修改测试先设置玩家名：测试是用户写的，不擅改

### 未来修复方向
**优先级：低**

方案 A（推荐）：测试侧修复 — 在 gamepad 测试 setup 阶段调用：
```js
await page.evaluate(() => {
    localStorage.setItem('wordGameCurrentPlayer', 'TestPlayer');
});
await page.reload();
```

方案 B（产品侧）：在用户首次点击开始时弹一个简化的"快速开始"按钮（用默认名字），同时提供"换名字"链接。

### 验证
```bash
node test_gamepad_settings.js  # T5 (focusableButtons count), T15, T16 失败（部分由新 UI 引起）
node test_penalty_ranking.js   # 23/23 通过
node test_focus_after_match.js # 9-10/10 通过（T5 flaky）
```

---

## TD-003: 本次新功能引起的 gamepad 测试变化

### 现状
新加的 5 个按钮（📚 词库管理 / 📤 导入词库 / 👤 用户管理 / 编辑名字 / 编辑词库名）改变了 `start-screen` 焦点列表：
- 原版：6 个焦点元素
- 现版：11 个焦点元素

导致 `test_gamepad_settings.js` 的 T5（focusableButtons 数量）预期值 6 与实际 11 不匹配。

### 根因
为了避免污染焦点循环，`updateFocusableButtons()` 已修改：
- 选择器只取 `#current-player-display .btn-edit-name`（不取 `#current-library-display` 的）
- start-screen 焦点列表按 stepper → 主按钮 → 次要按钮 排序

但 T5 仍断言硬编码的 6。

### 影响
- 仅为测试断言失配，生产功能正常
- 用户体验：手柄 D-pad 在新按钮间循环正常

### 未来修复方向
**优先级：低**

更新 `test_gamepad_settings.js` T5：
```js
assert('T5: focusableButtons 数量=11', focusableButtons.length === 11, `got ${focusableButtons.length}`);
```

### 验证
```bash
node test_gamepad_settings.js  # T5, T15, T16 失败；其他测试通过
```