/**
 * 端到端测试：手柄修改开始界面三个设置
 *
 * 用法：node test_gamepad_settings.js
 * 前置：./start.sh start
 */
const { chromium } = require('/home/richardjl/.npm-global/lib/node_modules/playwright');

const URL = 'http://localhost:8080/';
const RESULTS = [];
let pass = 0, fail = 0;

function assert(name, cond, extra = '') {
    if (cond) {
        pass++;
        RESULTS.push(`✅ ${name}`);
        console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`);
    } else {
        fail++;
        RESULTS.push(`❌ ${name}`);
        console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`);
    }
}

async function main() {
    const browser = await chromium.launch({
        headless: true,
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    // 捕获控制台错误（忽略无关的 favicon 404，这是项目本身没放 favicon 的问题）
    const errors = [];
    page.on('pageerror', e => {
        if (e.message.includes('id') || e.message.includes('reading')) {
            errors.push(`pageerror: ${e.message}\n${e.stack || ''}`);
        }
    });
    page.on('console', msg => {
        if (msg.type() === 'error') {
            const text = msg.text();
            // 过滤掉无关的 favicon 404
            if (text.includes('favicon') || text.includes('404')) return;
            errors.push(`console.error: ${text}`);
        }
    });

    console.log('📡 打开页面…');
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#start-screen.active', { timeout: 5000 });

    // ===== 1. 三个 stepper 渲染正确 =====
    const steppers = await page.$$('.setting-stepper');
    assert('T1: 三个 stepper 渲染', steppers.length === 3, `found ${steppers.length}`);

    const wordsDisplay = await page.textContent('#display-words-per-level');
    const livesDisplay = await page.textContent('#display-lives-count');
    const speedDisplay = await page.textContent('#display-speed-setting');
    assert('T2a: words 默认值', wordsDisplay === '25 个单词', `got "${wordsDisplay}"`);
    assert('T2b: lives 默认值', livesDisplay === '100 次', `got "${livesDisplay}"`);
    assert('T2c: speed 默认值', speedDisplay === '正常', `got "${speedDisplay}"`);

    const wordsVal = await page.$eval('#words-per-level', el => el.value);
    const livesVal = await page.$eval('#lives-count', el => el.value);
    const speedVal = await page.$eval('#speed-setting', el => el.value);
    assert('T3a: words select 默认值', wordsVal === '25', `got "${wordsVal}"`);
    assert('T3b: lives select 默认值', livesVal === '100', `got "${livesVal}"`);
    assert('T3c: speed select 默认值', speedVal === '1', `got "${speedVal}"`);

    // ===== 2. 注入 mock 手柄并连接 =====
    await page.evaluate(() => {
        // 持续返回同一个 mock 对象（持久化 prevButtons/edgePressed 状态）
        window._mockGamepad = {
            id: 'TestPad',
            index: 0,
            buttons: Array(17).fill(null).map(() => ({ pressed: false, value: 0, touched: false })),
            axes: [0, 0, 0, 0],
            connected: true,
            mapping: 'standard',
            timestamp: performance.now()
        };
        navigator.getGamepads = () => [window._mockGamepad, null, null, null];
        // 触发 connected 事件（GamepadEvent 需要 .gamepad 属性）
        const evt = new Event('gamepadconnected');
        evt.gamepad = window._mockGamepad;
        window.dispatchEvent(evt);
    });

    await page.waitForFunction(() => window.gamepadController && window.gamepadController.connected, { timeout: 2000 });
    const connected = await page.evaluate(() => window.gamepadController.connected);
    assert('T4: mock 手柄已连接', connected === true);

    // ===== 3. 聚焦按钮列表应包含三个 stepper =====
    await page.evaluate(() => window.game.updateFocusableButtons());
    const focusableInfo = await page.evaluate(() => {
        const game = window.game;
        return {
            count: game.focusableButtons.length,
            firstThree: game.focusableButtons.slice(0, 3).map(el => el.id || el.className),
            focusedIndex: game.focusedButtonIndex
        };
    });
    assert('T5: focusableButtons 数量=6', focusableInfo.count === 6, `got ${focusableInfo.count}`);
    assert('T5a: 前3个是 stepper', focusableInfo.firstThree.every(s => s.includes('stepper')),
        JSON.stringify(focusableInfo.firstThree));

    // ===== 4. 辅助函数：模拟一次按键按下 =====
    async function pressButton(btnIdx) {
        await page.evaluate((idx) => {
            // 释放所有按键确保 prevButtons 是干净的
            for (let i = 0; i < window._mockGamepad.buttons.length; i++) {
                window._mockGamepad.buttons[i].pressed = false;
            }
            // 强制重置 lastPoll 让 update 一定会处理
            window.gamepadController.lastPoll = 0;
            // 先调用一次 update 让 prevButtons 全部归零
            window.gamepadController.update();
            // 然后按下目标按键
            window._mockGamepad.buttons[idx].pressed = true;
            // 再强制重置 lastPoll 让下一次 update 一定会处理
            window.gamepadController.lastPoll = 0;
        }, btnIdx);
        // 等超过 50ms 的 pollInterval
        await page.waitForTimeout(80);
        // 调用 pollGamepad 触发消费
        await page.evaluate(() => window.game.pollGamepad(0.016));
        // 释放按键（否则下一次 update 不会产生新的 edge）
        await page.evaluate((idx) => {
            window._mockGamepad.buttons[idx].pressed = false;
            window.gamepadController.lastPoll = 0;
            window.gamepadController.update();
        }, btnIdx);
        await page.waitForTimeout(20);
    }

    // ===== 5. D-pad Right 在 words stepper：25 → 30 =====
    await pressButton(15); // D-pad Right
    let v = await page.$eval('#words-per-level', el => el.value);
    let txt = await page.textContent('#display-words-per-level');
    assert('T6: D-pad Right → words 25→30', v === '30' && txt === '30 个单词',
        `value=${v} display=${txt}`);

    // ===== 6. D-pad Right 循环：30→40→50→10 =====
    await pressButton(15);
    v = await page.$eval('#words-per-level', el => el.value);
    assert('T7a: 30→40', v === '40', `got ${v}`);
    await pressButton(15);
    v = await page.$eval('#words-per-level', el => el.value);
    assert('T7b: 40→50', v === '50', `got ${v}`);
    await pressButton(15);
    v = await page.$eval('#words-per-level', el => el.value);
    assert('T7c: 50→10 (wrap)', v === '10', `got ${v}`);

    // ===== 7. D-pad Left 反向 =====
    await pressButton(14); // D-pad Left
    v = await page.$eval('#words-per-level', el => el.value);
    assert('T8: D-pad Left → 10→50 (wrap)', v === '50', `got ${v}`);

    // ===== 8. A 键在 words stepper：前进一档 =====
    // 重置：让 words 回到 25（连续 Left 7 次：50→40→30→25）
    for (let i = 0; i < 2; i++) await pressButton(14);
    v = await page.$eval('#words-per-level', el => el.value);
    assert('T9a: 50→30 (左 2 次)', v === '30', `got ${v}`);
    // 按 A (button 0)
    await pressButton(0);
    v = await page.$eval('#words-per-level', el => el.value);
    assert('T9b: A → 30→40 (stepper 前进)', v === '40', `got ${v}`);

    // ===== 9. D-pad Down：移动到 lives stepper =====
    await pressButton(13); // D-pad Down
    const focusedIdx = await page.evaluate(() => window.game.focusedButtonIndex);
    const focusedId = await page.evaluate(() => window.game.focusableButtons[window.game.focusedButtonIndex]?.id);
    assert('T10: D-pad Down → lives stepper (index 1)', focusedIdx === 1 && focusedId === 'stepper-lives-count',
        `idx=${focusedIdx} id=${focusedId}`);

    // ===== 10. D-pad Left 在 lives stepper：100 → 50 =====
    await pressButton(14);
    v = await page.$eval('#lives-count', el => el.value);
    assert('T11: lives 100→50', v === '50', `got ${v}`);

    // ===== 11. D-pad Down：移动到 speed stepper =====
    await pressButton(13);
    const focused2 = await page.evaluate(() => ({
        idx: window.game.focusedButtonIndex,
        id: window.game.focusableButtons[window.game.focusedButtonIndex]?.id
    }));
    assert('T12: D-pad Down → speed stepper', focused2.idx === 2 && focused2.id === 'stepper-speed-setting',
        JSON.stringify(focused2));

    // ===== 12. D-pad Right 在 speed stepper：1 → 1.5 =====
    await pressButton(15);
    v = await page.$eval('#speed-setting', el => el.value);
    txt = await page.textContent('#display-speed-setting');
    assert('T13: speed 1→1.5', v === '1.5' && txt === '中快', `value=${v} display=${txt}`);

    // ===== 13. D-pad Down 一次：到 btn-start =====
    await pressButton(13);
    const focused3 = await page.evaluate(() => ({
        idx: window.game.focusedButtonIndex,
        id: window.game.focusableButtons[window.game.focusedButtonIndex]?.id
    }));
    assert('T14: D-pad Down → btn-start', focused3.id === 'btn-start',
        JSON.stringify(focused3));

    // ===== 14. A 键确认：进入游戏 =====
    await pressButton(0);
    await page.waitForTimeout(300);
    const currentScreen = await page.evaluate(() => window.game.currentScreen);
    assert('T15: A → 进入游戏 (game-screen)', currentScreen === 'game-screen',
        `currentScreen=${currentScreen}`);

    // 验证设置已生效（每关 40 个单词）
    const wordsPerLevel = await page.evaluate(() => window.wordManager.wordsPerLevel);
    assert('T16: 游戏中 wordsPerLevel=40', wordsPerLevel === 40, `got ${wordsPerLevel}`);

    // ===== 15. 鼠标点击 stepper 也应该工作 =====
    // 退出回 start screen
    await page.evaluate(() => window.game.quitGame());
    await page.waitForTimeout(100);
    const screenAfterQuit = await page.evaluate(() => window.game.currentScreen);
    assert('T17: quitGame → start-screen', screenAfterQuit === 'start-screen', screenAfterQuit);

    // 点击 lives 的 ▶ 按钮
    await page.click('#stepper-lives-count .stepper-next');
    v = await page.$eval('#lives-count', el => el.value);
    assert('T18: 点击 ▶ → lives 100 (从 50→100)', v === '100', `got ${v}`);

    // 点击 lives 的 ◀ 按钮
    await page.click('#stepper-lives-count .stepper-prev');
    v = await page.$eval('#lives-count', el => el.value);
    assert('T19: 点击 ◀ → lives 100→50', v === '50', `got ${v}`);

    // ===== 16. 视觉验证：截图 =====
    await page.screenshot({ path: '/tmp/start-screen-with-steppers.png', fullPage: false });
    console.log('📸 已截图：/tmp/start-screen-with-steppers.png');

    // 聚焦 stepper 后再截图
    await page.evaluate(() => {
        window.game.focusedButtonIndex = 0;
        window.game.applyButtonFocus();
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: '/tmp/stepper-focused.png', fullPage: false });
    console.log('📸 已截图：/tmp/stepper-focused.png');

    // ===== 17. 页面无错误 =====
    assert('T20: 页面无 JS 错误', errors.length === 0, errors.join(' | '));

    await browser.close();

    console.log(`\n=== 测试结果：${pass} 通过 / ${fail} 失败 ===`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('💥 测试异常：', err);
    process.exit(2);
});