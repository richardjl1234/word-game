/**
 * 回归测试：正确匹配一个单词后，下一个目标应该自动获得 .focused 焦点高亮
 *
 * 用法：node test_focus_after_match.js
 * 前置：./start.sh start
 */
const { chromium } = require('/home/richardjl/.npm-global/lib/node_modules/playwright');

const URL = 'http://localhost:8080/';
let pass = 0, fail = 0;

function assert(name, cond, extra = '') {
    if (cond) { pass++; console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`); }
    else      { fail++; console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main() {
    const browser = await chromium.launch({
        headless: true,
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const errors = [];
    page.on('pageerror', e => {
        // 过滤掉测试中合成 gamepad 事件导致的 e.gamepad.id 报错
        if (e.message.includes("reading 'id'")) return;
        errors.push(`pageerror: ${e.message}`);
    });
    page.on('console', msg => {
        if (msg.type() === 'error') {
            const text = msg.text();
            if (text.includes('favicon') || text.includes('404')) return;
            errors.push(`console.error: ${text}`);
        }
    });

    console.log('📡 打开页面…');
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#start-screen.active');
    await page.waitForFunction(() => window.game && window.game.initDone, { timeout: 5000 })
        .catch(() => {});

    // ===== 1. 进入游戏（关卡 1）=====
    await page.evaluate(() => window.game.startGame(1));
    await page.waitForSelector('#game-screen.active');
    // 等游戏初始化和首次 applyWordFocus（startGame 里 setTimeout 100ms）
    await page.waitForTimeout(500);

    // ===== 2. 验证：进入游戏后第一个目标单词应该有 .focused 高亮 =====
    const initialState = await page.evaluate(() => {
        const focusedEls = Array.from(document.querySelectorAll('.word-bubble.focused'));
        return {
            focusedCount: focusedEls.length,
            focusedText: focusedEls.map(el => el.textContent),
            aliveCount: document.querySelectorAll('.word-bubble').length
        };
    });
    assert('T1: 进入游戏后有 1 个 .focused 单词', initialState.focusedCount === 1,
        `count=${initialState.focusedCount} text=${JSON.stringify(initialState.focusedText)} alive=${initialState.aliveCount}`);

    // ===== 3. 通过 A 键（或直接调用 handleWordClick）模拟匹配当前焦点单词 =====
    // 不需要真正的手柄连接，直接调用 selectFocusedWord（与 A 键等价）
    // 直接调用 selectFocusedWord（与 A 键等价）
    await page.evaluate(() => window.game.selectFocusedWord());
    // 等动画（createWordHitAnimation 800ms）+ setNextTarget/forceSpawnTarget
    await page.waitForTimeout(1000);

    // ===== 4. 验证：下一个目标单词现在应该有 .focused 高亮 =====
    const afterMatchState = await page.evaluate(() => {
        const focusedEls = Array.from(document.querySelectorAll('.word-bubble.focused'));
        const allBubbles = Array.from(document.querySelectorAll('.word-bubble'));
        return {
            focusedCount: focusedEls.length,
            focusedText: focusedEls.map(el => el.textContent),
            aliveCount: allBubbles.length,
            aliveText: allBubbles.map(el => el.textContent)
        };
    });
    assert('T2: 匹配后 .focused 单词数量 = 1', afterMatchState.focusedCount === 1,
        `count=${afterMatchState.focusedCount} text=${JSON.stringify(afterMatchState.focusedText)}`);

    // 验证 focused 的单词是 alive 列表中的某一个
    if (afterMatchState.focusedCount === 1) {
        const focusedWord = afterMatchState.focusedText[0];
        assert('T3: focused 单词存在于 alive 列表中',
            afterMatchState.aliveText.includes(focusedWord),
            `focused="${focusedWord}" alive=${JSON.stringify(afterMatchState.aliveText)}`);
    }

    // ===== 5. 验证：focused 单词应该是当前 targetMeaning =====
    if (afterMatchState.focusedCount === 1) {
        const isTarget = await page.evaluate(() => {
            const focused = document.querySelector('.word-bubble.focused');
            return focused && window.game.targetMeaning && focused.textContent === window.game.targetMeaning.word;
        });
        assert('T4: focused 单词 === targetMeaning.word', isTarget === true,
            `isTarget=${isTarget}`);
    }

    // ===== 6. 多次连续匹配：每次匹配后都应保持 .focused =====
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.game.selectFocusedWord());
        await page.waitForTimeout(900);
        const s = await page.evaluate(() => ({
            focusedCount: document.querySelectorAll('.word-bubble.focused').length,
            currentTarget: window.game.targetMeaning?.word
        }));
        assert(`T5.${i+1}: 第 ${i+1} 次匹配后有 1 个 focused`, s.focusedCount === 1,
            `count=${s.focusedCount} target=${s.currentTarget}`);
    }

    // ===== 7. 截图：确认视觉高亮存在 =====
    await page.screenshot({ path: '/tmp/focus-after-match.png' });
    console.log('📸 已截图：/tmp/focus-after-match.png');

    assert('T6: 页面无 JS 错误', errors.length === 0, errors.join(' | '));

    await browser.close();
    console.log(`\n=== 测试结果：${pass} 通过 / ${fail} 失败 ===`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('💥 测试异常：', err);
    process.exit(2);
});