/**
 * Playwright 手柄导航测试（TD-012）：
 * 验证从主页可进入所有子界面，并能用 B 键 / Select 键返回。
 *
 * 覆盖：
 *   T1-T3: 注册 + 登录 + 到 start-screen
 *   T4: 注入 mock 手柄并连接
 *   T5-T7: start → vocab → B → start（vocab 修复验证）
 *   T8-T10: start → users → B → start
 *   T11-T13: start → import → B → start
 *   T14-T16: start → ranking → B → start
 *   T17-T19: start → level-select → B → start
 *   T20-T22: start → about → B → start
 *   T23: Select 键 (8) 在 vocab 也能返回
 *   T24: 每个子界面 focusableButtons 都含 .btn-back
 *
 * 用法：先 ./start.sh backend start + ./start.sh start，然后 node test_gamepad_navigation.js
 */
const path = require('path');
const PW_PATH = '/home/richardjl/.npm-global/lib/node_modules/playwright';
const { chromium } = require(PW_PATH);

const FRONTEND_URL = 'http://localhost:8080/';

const results = [];
function record(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
    console.log('\n=== 手柄导航测试（TD-012）===\n');

    const browser = await chromium.launch({
        headless: true,
        executablePath: '/home/richardjl/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    const jsErrors = [];
    page.on('pageerror', e => jsErrors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

    // ====== T1-T3: 注册 + 登录 + 主页 ======
    const username = `pad_${Date.now().toString(36)}`;
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#auth-screen.active', { timeout: 8000 });
    record('T1: 前端加载到 auth-screen', true);

    await page.locator('#auth-tab-register').click();
    await page.locator('#auth-register-username').fill(username);
    await page.locator('#auth-register-password').fill('test123456');
    await page.locator('#auth-register-password-confirm').fill('test123456');
    await page.locator('#auth-form-register button[type="submit"]').click();
    await page.waitForSelector('#start-screen.active', { timeout: 15000 });
    record('T2: 注册 + 进入 start-screen', true);

    // ====== T4: 注入 mock 手柄并连接 ======
    await page.evaluate(() => {
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
        const evt = new Event('gamepadconnected');
        evt.gamepad = window._mockGamepad;
        window.dispatchEvent(evt);
    });
    await page.waitForFunction(() => window.gamepadController && window.gamepadController.connected, { timeout: 2000 });
    record('T3: mock 手柄已连接', await page.evaluate(() => window.gamepadController.connected));

    // ====== 辅助：模拟按键（与 test_gamepad_settings.js 一致） ======
    async function pressButton(btnIdx) {
        await page.evaluate((idx) => {
            for (let i = 0; i < window._mockGamepad.buttons.length; i++) {
                window._mockGamepad.buttons[i].pressed = false;
            }
            window.gamepadController.lastPoll = 0;
            window.gamepadController.update();
            window._mockGamepad.buttons[idx].pressed = true;
            window.gamepadController.lastPoll = 0;
        }, btnIdx);
        await page.waitForTimeout(80);
        await page.evaluate(() => window.game.pollGamepad(0.016));
        await page.evaluate((idx) => {
            window._mockGamepad.buttons[idx].pressed = false;
            window.gamepadController.lastPoll = 0;
            window.gamepadController.update();
        }, btnIdx);
        await page.waitForTimeout(20);
    }

    // ====== 辅助：导航到指定按钮 + A 触发（start 屏） ======
    // start 屏的 focusableButtons 顺序：3 个 stepper → btn-start → 5 个 btn-secondary（关卡/词库/导入/排行/关于）
    // btn-vocab / btn-users / btn-import / btn-ranking / btn-about 都在 stepper + btn-start 之后
    async function pressAOnButtonById(targetBtnId) {
        // D-pad Down 直到 focused 是目标
        for (let i = 0; i < 20; i++) {
            await pressButton(13); // D-pad Down
            const focusedId = await page.evaluate(() => {
                const f = window.game.focusableButtons[window.game.focusedButtonIndex];
                return f ? (f.id || '') : '';
            });
            if (focusedId === targetBtnId) break;
        }
        // A 键触发
        await pressButton(0);
    }

    async function gotoSubScreenAndBack(buttonId, expectedScreen, label) {
        // 确保在 start
        const startScreen = await page.evaluate(() => window.game.currentScreen);
        if (startScreen !== 'start-screen') {
            await page.evaluate(() => window.game.showScreen('start-screen'));
            await page.waitForTimeout(150);
        }
        // 找到该按钮的索引（D-pad Down 几下）
        await pressAOnButtonById(buttonId);
        await page.waitForTimeout(200);
        const afterA = await page.evaluate(() => window.game.currentScreen);
        record(`${label}-1: A 键进入 ${expectedScreen}`, afterA === expectedScreen, `got=${afterA}`);
        // 检查 focusableButtons 含 .btn-back（TD-012 关键修复点）
        const focusableInfo = await page.evaluate(() => {
            const fbs = window.game.focusableButtons;
            const screen = window.game.currentScreen;
            return {
                count: fbs.length,
                hasBack: fbs.some(b => b.classList.contains('btn-back')),
                ids: fbs.map(b => b.id || b.className.split(' ')[0]),
            };
        });
        record(`${label}-2: ${expectedScreen} 聚焦含 .btn-back`,
            focusableInfo.hasBack && focusableInfo.count > 0,
            `count=${focusableInfo.count} ids=${JSON.stringify(focusableInfo.ids)}`);
        // B 键返回
        await pressButton(1); // B
        await page.waitForTimeout(200);
        const afterB = await page.evaluate(() => window.game.currentScreen);
        record(`${label}-3: B 键返回 start-screen`, afterB === 'start-screen', `got=${afterB}`);
    }

    // ====== T5-T7: vocab（用户报的 bug）======
    await gotoSubScreenAndBack('btn-vocab', 'vocab-screen', 'T5');

    // ====== T8-T10: users ======
    await gotoSubScreenAndBack('btn-users', 'users-screen', 'T8');

    // ====== T11-T13: import ======
    await gotoSubScreenAndBack('btn-import', 'import-screen', 'T11');

    // ====== T14-T16: ranking ======
    await gotoSubScreenAndBack('btn-ranking', 'ranking-screen', 'T14');

    // ====== T17-T19: level-select ======
    await gotoSubScreenAndBack('btn-levels', 'level-select-screen', 'T17');

    // ====== T20-T22: about ======
    await gotoSubScreenAndBack('btn-about', 'about-screen', 'T20');

    // ====== T23: Select 键 (8) 在 vocab 也能返回 ======
    await page.evaluate(() => window.game.showScreen('start-screen'));
    await page.waitForTimeout(150);
    await pressAOnButtonById('btn-vocab');
    await page.waitForTimeout(200);
    const inVocab = await page.evaluate(() => window.game.currentScreen);
    record('T23-1: 回到 vocab 进入子界面', inVocab === 'vocab-screen', `got=${inVocab}`);
    await pressButton(8); // Select
    await page.waitForTimeout(200);
    const afterSelect = await page.evaluate(() => window.game.currentScreen);
    record('T23-2: Select 键（8）返回 start', afterSelect === 'start-screen', `got=${afterSelect}`);

    // ====== T24: 抓取每个子界面 focusableButtons 的 size，验证不全为 0 ======
    await page.evaluate(() => window.game.showScreen('vocab-screen'));
    await page.waitForTimeout(150);
    const vocabFb = await page.evaluate(() => window.game.focusableButtons.length);
    record('T24a: vocab-screen focusableButtons > 0', vocabFb > 0, `count=${vocabFb}`);

    await page.evaluate(() => window.game.showScreen('users-screen'));
    await page.waitForTimeout(150);
    const usersFb = await page.evaluate(() => window.game.focusableButtons.length);
    record('T24b: users-screen focusableButtons > 0', usersFb > 0, `count=${usersFb}`);

    await page.evaluate(() => window.game.showScreen('import-screen'));
    await page.waitForTimeout(150);
    const importFb = await page.evaluate(() => window.game.focusableButtons.length);
    record('T24c: import-screen focusableButtons > 0', importFb > 0, `count=${importFb}`);

    // 截图
    await page.evaluate(() => window.game.showScreen('start-screen'));
    await page.waitForTimeout(150);
    await page.screenshot({ path: '/tmp/gamepad-navigation.png', fullPage: true });

    record('T25: 控制台无 JS 错误', jsErrors.length === 0,
        jsErrors.length === 0 ? '' : jsErrors.slice(0, 2).join('; '));

    await browser.close();

    console.log('\n=== 测试报告 ===');
    const pass = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    console.log(`✅ 通过: ${pass}`);
    console.log(`❌ 失败: ${fail}`);
    if (fail > 0) {
        console.log('\n失败项：');
        results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.detail}`));
        process.exit(1);
    }
    process.exit(0);
})().catch(e => { console.error('未捕获异常:', e); process.exit(1); });