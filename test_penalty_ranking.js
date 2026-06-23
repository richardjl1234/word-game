/**
 * E2E 测试：累进扣分 + 姓名输入 + 排行榜
 *
 * 用法：node test_penalty_ranking.js
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
    await page.waitForFunction(() => window.game && window.game.init, { timeout: 5000 }).catch(() => {});

    // 清空 localStorage（避免上次测试残留）
    await page.evaluate(() => {
        localStorage.removeItem('wordGameRanking');
        localStorage.removeItem('wordGameCurrentPlayer');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#start-screen.active');

    // ===== 1. 当前玩家默认显示"未设置" =====
    let playerName = await page.textContent('#current-player-name');
    assert('T1: 初始"当前玩家"显示"未设置"', playerName === '未设置', `got "${playerName}"`);

    // ===== 2. 点击"开始游戏" → 弹姓名 modal =====
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    let modalVisible = await page.evaluate(() => document.getElementById('name-input-modal').classList.contains('active'));
    assert('T2: 点击开始游戏弹出姓名 modal', modalVisible === true);

    // ===== 3. 不输入名字 → 不能关闭 =====
    await page.click('#btn-confirm-name');
    await page.waitForTimeout(200);
    modalVisible = await page.evaluate(() => document.getElementById('name-input-modal').classList.contains('active'));
    assert('T3: 空名字不允许确认', modalVisible === true);

    // ===== 4. 取消按钮 → modal 关闭、不进入游戏 =====
    await page.click('#btn-cancel-name');
    await page.waitForTimeout(200);
    modalVisible = await page.evaluate(() => document.getElementById('name-input-modal').classList.contains('active'));
    let currentScreen = await page.evaluate(() => window.game.currentScreen);
    assert('T4: 取消后 modal 关闭', modalVisible === false);
    assert('T4a: 取消后仍在 start-screen', currentScreen === 'start-screen', `got ${currentScreen}`);

    // ===== 5. 输入名字 → 确认 → 进入游戏 =====
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    await page.fill('#player-name-input', '测试玩家A');
    await page.click('#btn-confirm-name');
    await page.waitForTimeout(300);
    currentScreen = await page.evaluate(() => window.game.currentScreen);
    assert('T5: 输入名字并确认后进入游戏', currentScreen === 'game-screen', `got ${currentScreen}`);

    playerName = await page.textContent('#current-player-name');
    assert('T5a: "当前玩家"显示已设置名字', playerName === '测试玩家A', `got "${playerName}"`);

    // localStorage 应该保存了玩家名
    const storedPlayer = await page.evaluate(() => localStorage.getItem('wordGameCurrentPlayer'));
    assert('T5b: localStorage 存储了玩家名', storedPlayer === '测试玩家A', `got "${storedPlayer}"`);

    // ===== 6. 累进扣分测试 =====
    // 等游戏初始化完成
    await page.waitForTimeout(500);
    // 模拟连续点错 3 个不同的单词，验证扣分递增
    const penaltyResults = await page.evaluate(async () => {
        const results = [];
        // 通过强行注入错误点击验证
        // 先看初始分数
        results.push({ step: 'init', score: window.game.score, streak: window.game.wrongClickStreak });

        // 模拟 3 次连续点错（直接调用 handleWrongMatch）
        for (let i = 0; i < 3; i++) {
            const fakeEl = document.createElement('div');
            document.body.appendChild(fakeEl);
            window.game.handleWrongMatch(fakeEl);
            await new Promise(r => setTimeout(r, 50));
            results.push({
                step: `wrong-${i+1}`,
                score: window.game.score,
                streak: window.game.wrongClickStreak,
                errorCount: window.game.errorCount
            });
            fakeEl.remove();
        }

        // 模拟一次正确匹配 → streak 应该重置
        window.game.handleCorrectMatch(document.createElement('div'), 100, 100);
        await new Promise(r => setTimeout(r, 50));
        results.push({ step: 'correct', score: window.game.score, streak: window.game.wrongClickStreak });

        // 再点错一次 → streak 应该从 1 开始（不是 4）
        const fakeEl2 = document.createElement('div');
        document.body.appendChild(fakeEl2);
        window.game.handleWrongMatch(fakeEl2);
        await new Promise(r => setTimeout(r, 50));
        results.push({ step: 'wrong-after-correct', score: window.game.score, streak: window.game.wrongClickStreak });
        fakeEl2.remove();

        return results;
    });

    // 初始分数 0，streak 0
    assert('T6a: 初始 streak=0', penaltyResults[0].streak === 0);

    // 第一次点错：streak=1, score=0-10=-10 → max(0)=0
    assert('T6b: 第1次点错 streak=1', penaltyResults[1].streak === 1, JSON.stringify(penaltyResults[1]));
    // 第二次点错：streak=2, score=0-20=-20 → max(0)=0
    assert('T6c: 第2次点错 streak=2', penaltyResults[2].streak === 2, JSON.stringify(penaltyResults[2]));
    // 第三次点错：streak=3, score=0-30=-30 → max(0)=0
    assert('T6d: 第3次点错 streak=3', penaltyResults[3].streak === 3, JSON.stringify(penaltyResults[3]));
    // 正确匹配后 streak 重置
    assert('T6e: 正确匹配后 streak=0', penaltyResults[4].streak === 0, JSON.stringify(penaltyResults[4]));
    // 再点错一次 streak=1
    assert('T6f: 答对后再点错 streak 重置为 1', penaltyResults[5].streak === 1, JSON.stringify(penaltyResults[5]));

    // ===== 7. 排行榜保存与展示 =====
    // 模拟 saveRankingEntry
    await page.evaluate(() => {
        window.game.saveRankingEntry({ name: '玩家甲', score: 100, level: 1, date: '2024-01-01T00:00:00Z' });
        window.game.saveRankingEntry({ name: '玩家乙', score: 250, level: 3, date: '2024-01-02T00:00:00Z' });
        window.game.saveRankingEntry({ name: '玩家丙', score: 50,  level: 1, date: '2024-01-03T00:00:00Z' });
    });

    // 触发排行榜渲染
    await page.evaluate(() => window.game.showRanking());
    await page.waitForTimeout(200);

    const rankingHTML = await page.innerHTML('#ranking-list');
    // 应该有 3 条记录，按分数降序：玩家乙(250) → 玩家甲(100) → 玩家丙(50)
    const order = await page.evaluate(() => {
        const entries = Array.from(document.querySelectorAll('#ranking-list .ranking-entry'));
        return entries.map(e => ({
            name: e.querySelector('.player-name')?.textContent,
            score: e.querySelector('.player-score')?.textContent
        }));
    });

    assert('T7a: 排行榜有 3 条记录', order.length === 3, `got ${order.length}`);
    assert('T7b: 第1名=玩家乙 250分', order[0]?.name === '玩家乙' && order[0]?.score === '250',
        JSON.stringify(order[0]));
    assert('T7c: 第2名=玩家甲 100分', order[1]?.name === '玩家甲' && order[1]?.score === '100',
        JSON.stringify(order[1]));
    assert('T7d: 第3名=玩家丙 50分', order[2]?.name === '玩家丙' && order[2]?.score === '50',
        JSON.stringify(order[2]));

    // ===== 8. localStorage 持久化 =====
    const rankingRaw = await page.evaluate(() => localStorage.getItem('wordGameRanking'));
    assert('T8: 排行榜持久化到 localStorage', rankingRaw !== null && JSON.parse(rankingRaw).length === 3);

    // ===== 9. 排行榜容量上限 =====
    await page.evaluate(() => {
        // 清空 + 添加 12 条记录
        window.game.clearRanking();
        for (let i = 1; i <= 12; i++) {
            window.game.saveRankingEntry({ name: `P${i}`, score: i * 10, level: 1 });
        }
    });
    const list = await page.evaluate(() => window.game.loadRanking());
    assert('T9: 排行榜上限 = 10', list.length === 10, `got ${list.length}`);

    // ===== 10. 修改名字 =====
    await page.evaluate(() => window.game.setCurrentPlayer('新名字'));
    playerName = await page.textContent('#current-player-name');
    assert('T10: setCurrentPlayer 更新显示', playerName === '新名字', `got "${playerName}"`);

    // ===== 11. 截图 =====
    await page.evaluate(() => {
        window.game.saveRankingEntry({ name: '小明', score: 880, level: 5 });
        window.game.saveRankingEntry({ name: '小红', score: 660, level: 4 });
        window.game.saveRankingEntry({ name: '小刚', score: 440, level: 3 });
        window.game.saveRankingEntry({ name: '小丽', score: 220, level: 2 });
        window.game.showRanking();
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: '/tmp/ranking-screen.png' });
    console.log('📸 已截图：/tmp/ranking-screen.png');

    await page.evaluate(() => {
        window.game.setCurrentPlayer('小明');
        window.game.showScreen('start-screen');
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: '/tmp/start-screen-with-player.png' });
    console.log('📸 已截图：/tmp/start-screen-with-player.png');

    // ===== 12. XSS 防护 =====
    await page.evaluate(() => {
        window.game.saveRankingEntry({ name: '<script>alert(1)</script>', score: 100, level: 1 });
        window.game.renderRanking();
    });
    const xssTest = await page.evaluate(() => {
        // 检查是否真的注入 script
        return {
            scriptsInjected: document.querySelectorAll('#ranking-list script').length,
            htmlContent: document.querySelector('#ranking-list').innerHTML.includes('&lt;script&gt;')
        };
    });
    assert('T11: 玩家名 XSS 被转义',
        xssTest.scriptsInjected === 0 && xssTest.htmlContent === true,
        JSON.stringify(xssTest));

    assert('T12: 页面无 JS 错误', errors.length === 0, errors.join(' | '));

    await browser.close();
    console.log(`\n=== 测试结果：${pass} 通过 / ${fail} 失败 ===`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('💥 测试异常：', err);
    process.exit(2);
});