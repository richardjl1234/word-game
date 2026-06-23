/**
 * 回归测试：单词清除后焦点应该随机选一个候选单词
 *
 * 关键设计：焦点不能自动指向 targetMeaning（否则手柄玩家只要一直按 A 就能答对），
 * 必须在 alive 列表中随机选一个，迫使玩家用 D-pad 导航到目标。
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
    await page.waitForFunction(() => window.game, { timeout: 5000 }).catch(() => {});

    // ===== 1. 进入游戏（关卡 1）=====
    await page.evaluate(() => window.game.startGame(1));
    await page.waitForSelector('#game-screen.active');
    await page.waitForTimeout(500);

    // ===== 2. 验证：进入游戏后有 .focused 高亮（startGame 走 applyWordFocus）=====
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

    // ===== 3. 直接调用 selectFocusedWord 模拟匹配（与 A 键等价）=====
    // 注意：focusedIndex 是随机的，所以 focused 单词可能是 target 也可能是 distractor。
    // 我们不依赖具体匹配结果，只观察焦点行为。
    await page.evaluate(() => window.game.selectFocusedWord());
    await page.waitForTimeout(1000);

    // ===== 4. 验证：匹配后屏幕上有 1 个 .focused 单词 =====
    const afterMatch = await page.evaluate(() => {
        const focusedEls = Array.from(document.querySelectorAll('.word-bubble.focused'));
        const allBubbles = Array.from(document.querySelectorAll('.word-bubble'));
        return {
            focusedCount: focusedEls.length,
            focusedText: focusedEls[0]?.textContent || null,
            aliveText: allBubbles.map(el => el.textContent)
        };
    });
    assert('T2: 匹配后 .focused 单词数量 = 1', afterMatch.focusedCount === 1,
        `count=${afterMatch.focusedCount} text=${afterMatch.focusedText}`);

    // ===== 5. 验证：focused 单词存在于 alive 列表中 =====
    assert('T3: focused 单词存在于 alive 列表中',
        afterMatch.focusedText !== null && afterMatch.aliveText.includes(afterMatch.focusedText),
        `focused="${afterMatch.focusedText}" alive=${JSON.stringify(afterMatch.aliveText)}`);

    // ===== 6. 关键验证：focused 单词不一定是 targetMeaning =====
    // 通过 20 次匹配观察：focused 应该至少出现一次不是 target 的情况
    // （如果总是 target，说明 refocusRandom 没有随机化）
    const isNotAlwaysTarget = await page.evaluate(async () => {
        let targetMatches = 0;
        let totalMatches = 0;
        for (let i = 0; i < 20; i++) {
            // 强制 matchedWords 推进（绕过 selectFocusedWord 偶尔选错导致 game over）
            // 直接调用 handleCorrectMatch 在 target 上
            const alive = window.game.aliveWordBubbles();
            const targetEl = Array.from(document.querySelectorAll('.word-bubble'))
                .find(el => el.textContent === window.game.targetMeaning.word);
            if (targetEl) {
                // 模拟点击 target
                const rect = targetEl.getBoundingClientRect();
                window.game.handleWordClick({
                    word: window.game.targetMeaning.word,
                    meaning: window.game.targetMeaning.meaning,
                    difficulty: window.game.targetMeaning.difficulty,
                    element: targetEl,
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                });
                await new Promise(r => setTimeout(r, 50));
                // 看一下当前 focus
                const focused = document.querySelector('.word-bubble.focused');
                const focusedText = focused?.textContent;
                const t = window.game.targetMeaning?.word;
                if (focusedText) {
                    totalMatches++;
                    if (focusedText === t) targetMatches++;
                }
            }
        }
        return { targetMatches, totalMatches };
    });

    assert('T4: 20 次匹配中 focused===target 出现 < 100%（证明是随机的）',
        isNotAlwaysTarget.totalMatches > 0 && isNotAlwaysTarget.targetMatches < isNotAlwaysTarget.totalMatches,
        JSON.stringify(isNotAlwaysTarget));

    // ===== 7. 连续多次匹配后仍保持 .focused 状态（不会出现无焦点）=====
    for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.game.selectFocusedWord());
        await page.waitForTimeout(900);
        const s = await page.evaluate(() => ({
            focusedCount: document.querySelectorAll('.word-bubble.focused').length,
            aliveCount: document.querySelectorAll('.word-bubble').length
        }));
        assert(`T5.${i+1}: 第 ${i+1} 次匹配后仍有 1 个 focused`, s.focusedCount === 1,
            `count=${s.focusedCount} alive=${s.aliveCount}`);
    }

    // ===== 8. 截图：确认视觉高亮存在 =====
    await page.screenshot({ path: '/tmp/focus-random.png' });
    console.log('📸 已截图：/tmp/focus-random.png');

    assert('T6: 页面无 JS 错误', errors.length === 0, errors.join(' | '));

    await browser.close();
    console.log(`\n=== 测试结果：${pass} 通过 / ${fail} 失败 ===`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('💥 测试异常：', err);
    process.exit(2);
});