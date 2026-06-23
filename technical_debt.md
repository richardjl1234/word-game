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