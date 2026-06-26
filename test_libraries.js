/**
 * 端到端测试：多词库 + 多用户
 *
 * 用法：node test_libraries.js
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

    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));

    console.log('📡 打开页面…');
    await page.goto(URL, { waitUntil: 'networkidle' });

    // task #36：先注册一个测试账号过 auth-screen
    await page.waitForSelector('#auth-screen.active', { timeout: 5000 });
    const username = `lib_${Date.now().toString(36)}`;
    await page.locator('#auth-tab-register').click();
    await page.waitForTimeout(200);
    await page.locator('#auth-register-username').fill(username);
    await page.locator('#auth-register-password').fill('test123456');
    await page.locator('#auth-register-password-confirm').fill('test123456');
    await page.locator('#auth-form-register button[type="submit"]').click();
    await page.waitForSelector('#start-screen.active', { timeout: 15000 });

    // 清空所有相关 localStorage
    await page.evaluate(() => {
        localStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle' });
    // 重新登录（reload 后 auth-screen 又出现）
    await page.waitForSelector('#auth-screen.active', { timeout: 5000 });
    await page.locator('#auth-login-username').fill(username);
    await page.locator('#auth-login-password').fill('test123456');
    await page.locator('#auth-form-login button[type="submit"]').click();
    await page.waitForSelector('#start-screen.active', { timeout: 15000 });

    // ============================================================
    // 1. 词库管理界面：默认词库 + 新建
    // ============================================================
    await page.click('#btn-vocab');
    await page.waitForSelector('#vocab-screen.active');
    await page.waitForTimeout(200);

    let libCount = await page.evaluate(() => window.librariesManager.listLibraries().length);
    assert('T1: 默认词库存在', libCount === 1, `count=${libCount}`);

    let currentLib = await page.evaluate(() => window.librariesManager.getCurrentLibraryId());
    assert('T2: 当前词库是 default', currentLib === 'default');

    // 新建词库
    await page.click('#btn-create-library');
    await page.waitForSelector('#name-input-modal.active');
    await page.fill('#player-name-input', '人教版初一');
    await page.click('#btn-confirm-name');
    await page.waitForTimeout(300);

    libCount = await page.evaluate(() => window.librariesManager.listLibraries().length);
    assert('T3: 新建后有 2 个词库', libCount === 2, `count=${libCount}`);

    // 切换到新词库
    await page.evaluate(() => {
        window.librariesManager.setCurrentLibrary(
            window.librariesManager.listLibraries().find(l => l.name === '人教版初一').id
        );
        window.wordManager.onLibraryChanged();
        window.game.renderLibraryList();
    });
    await page.waitForTimeout(200);

    currentLib = await page.evaluate(() => window.librariesManager.getCurrentLibraryId());
    assert('T4: 切换到「人教版初一」', currentLib !== 'default');

    let totalLevels = await page.evaluate(() => window.wordManager.totalLevels);
    assert('T5: 新空词库关卡数 = 1（兜底）', totalLevels === 1, `got ${totalLevels}`);

    // 添加单词到自定义词库
    await page.evaluate(() => {
        const lib = window.librariesManager.getCurrentLibrary();
        const words = [
            { word: 'apple', meaning: '苹果', difficulty: 1 },
            { word: 'banana', meaning: '香蕉', difficulty: 1 },
            { word: 'computer', meaning: '电脑', difficulty: 3 },
        ];
        window.librariesManager.addWords(lib.id, words);
        window.wordManager.onLibraryChanged();
    });

    totalLevels = await page.evaluate(() => window.wordManager.totalLevels);
    assert('T6: 3 词的新词库关卡数 = 1', totalLevels === 1);

    // 加到 50+ 词后应该 = 2 关
    await page.evaluate(() => {
        const lib = window.librariesManager.getCurrentLibrary();
        const words = [];
        for (let i = 1; i <= 60; i++) {
            words.push({ word: 'word' + i, meaning: '词' + i, difficulty: 1 });
        }
        window.librariesManager.addWords(lib.id, words);
        window.wordManager.onLibraryChanged();
    });

    totalLevels = await page.evaluate(() => window.wordManager.totalLevels);
    assert('T7: 63 词的词库关卡数 = 2', totalLevels === 2, `got ${totalLevels}`);

    // ============================================================
    // 2. 切换回默认词库，关卡数仍为 50
    // ============================================================
    await page.evaluate(() => {
        window.librariesManager.setCurrentLibrary('default');
        window.wordManager.onLibraryChanged();
    });

    totalLevels = await page.evaluate(() => window.wordManager.totalLevels);
    assert('T8: 默认词库关卡数 = 50', totalLevels === 50);

    // ============================================================
    // 3. 多用户
    // ============================================================
    await page.click('#btn-back-from-vocab');
    await page.waitForTimeout(100);
    await page.click('#btn-users');
    await page.waitForSelector('#users-screen.active');
    await page.waitForTimeout(200);

    // task #36：注册时自动建 1 个默认 profile（与 username 同名）
    let userCount = await page.evaluate(() => window.usersManager.listUsers().length);
    assert('T9: 初始用户数 = 1（注册时默认 profile）', userCount === 1, `count=${userCount}`);

    // 新建 Alice
    await page.click('#btn-create-user');
    await page.waitForSelector('#name-input-modal.active');
    await page.fill('#player-name-input', 'Alice');
    await page.click('#btn-confirm-name');
    await page.waitForTimeout(500);  // 等服务器创建

    userCount = await page.evaluate(() => window.usersManager.listUsers().length);
    assert('T10: 创建后用户数 = 2', userCount === 2, `count=${userCount}`);

    let currentUser = await page.evaluate(() => ({
        id: window.usersManager.getCurrentUserId(),
        name: window.usersManager.getCurrentUser()?.name,
    }));
    assert('T11: 当前用户 = Alice', currentUser.name === 'Alice', JSON.stringify(currentUser));

    // 新建 Bob
    await page.click('#btn-create-user');
    await page.waitForSelector('#name-input-modal.active');
    await page.fill('#player-name-input', 'Bob');
    await page.click('#btn-confirm-name');
    await page.waitForTimeout(500);

    userCount = await page.evaluate(() => window.usersManager.listUsers().length);
    assert('T12: 创建 Bob 后用户数 = 3', userCount === 3, `count=${userCount}`);

    // ============================================================
    // 4. 错词按用户 × 词库分桶
    // ============================================================
    await page.evaluate(() => {
        // Alice 在 default 词库加 2 个错词
        window.librariesManager.setCurrentLibrary('default');
        window.usersManager.switchUser(window.usersManager.listUsers().find(u => u.nickname === 'Alice').id);
        window.librariesManager.saveMissedWord('default', {
            word: 'apple', meaning: '苹果', difficulty: 1,
        });
        window.librariesManager.saveMissedWord('default', {
            word: 'banana', meaning: '香蕉', difficulty: 1,
        });

        // Bob 在 default 词库加 1 个不同的错词
        window.usersManager.switchUser(window.usersManager.listUsers().find(u => u.nickname === 'Bob').id);
        window.librariesManager.saveMissedWord('default', {
            word: 'cat', meaning: '猫', difficulty: 1,
        });
    });

    let aliceMissed = await page.evaluate(() => {
        const aliceId = window.usersManager.listUsers().find(u => u.nickname === 'Alice').id;
        window.usersManager.switchUser(aliceId);
        return window.librariesManager.getMissedWords('default').map(m => m.word);
    });
    assert('T13: Alice 的错词 = [apple, banana]',
        JSON.stringify(aliceMissed.sort()) === JSON.stringify(['apple', 'banana']),
        JSON.stringify(aliceMissed));

    let bobMissed = await page.evaluate(() => {
        const bobId = window.usersManager.listUsers().find(u => u.nickname === 'Bob').id;
        window.usersManager.switchUser(bobId);
        return window.librariesManager.getMissedWords('default').map(m => m.word);
    });
    assert('T14: Bob 的错词 = [cat]',
        JSON.stringify(bobMissed) === JSON.stringify(['cat']),
        JSON.stringify(bobMissed));

    // ============================================================
    // 5. 删除自定义词库
    // ============================================================
    await page.evaluate(() => {
        const lib = window.librariesManager.listLibraries().find(l => l.name === '人教版初一');
        if (lib) window.librariesManager.deleteLibrary(lib.id);
    });

    libCount = await page.evaluate(() => window.librariesManager.listLibraries().length);
    assert('T15: 删除自定义词库后剩 1 个', libCount === 1);

    // ============================================================
    // 6. 重命名词库
    // ============================================================
    await page.evaluate(() => {
        window.librariesManager.createLibrary('临时词库', 'manual');
    });
    await page.evaluate(() => {
        const lib = window.librariesManager.listLibraries().find(l => l.name === '临时词库');
        window.librariesManager.renameLibrary(lib.id, '改名后的词库');
    });
    let renamed = await page.evaluate(() => window.librariesManager.listLibraries().some(l => l.name === '改名后的词库'));
    assert('T16: 重命名成功', renamed === true);

    // 默认词库不能重命名
    let renameDefault = await page.evaluate(() => window.librariesManager.renameLibrary('default', '改名'));
    assert('T17: 默认词库拒绝重命名', renameDefault === false);

    // ============================================================
    // 7. 删除用户清理进度
    // ============================================================
    let progressKey = await page.evaluate(() => {
        const aliceId = window.usersManager.listUsers().find(u => u.nickname === 'Alice').id;
        window.usersManager.switchUser(aliceId);
        // 触发一次进度写入（模拟 Alice 完成第 1 关）
        window.wordManager.progressData = { completedLevels: [1], highScores: {1: 100}, missedWords: [], missedWordHits: {} };
        window.wordManager.saveProgress();
        return `wordGameProgress_${aliceId}_default`;
    });
    let hasProgress = await page.evaluate((k) => localStorage.getItem(k) !== null, progressKey);
    assert('T18: Alice 的进度已存', hasProgress === true);

    await page.evaluate(() => {
        const aliceId = window.usersManager.listUsers().find(u => u.nickname === 'Alice').id;
        window.usersManager.deleteUser(aliceId);
    });

    hasProgress = await page.evaluate((k) => localStorage.getItem(k) !== null, progressKey);
    assert('T19: Alice 删除后进度已清', hasProgress === false);

    // ============================================================
    // 8. 重复名字不允许
    // ============================================================
    let dupResult = await page.evaluate(async () => {
        try {
            await window.usersManager.createUser('Bob');  // 已存在
            return { created: true };
        } catch (e) {
            return { error: e.message };
        }
    });
    assert('T20: 重复用户名不允许', dupResult.error && dupResult.error.includes('已存在'), JSON.stringify(dupResult));

    // ============================================================
    // 页面无错误
    // ============================================================
    assert('T21: 页面无 JS 错误', errors.length === 0, errors.join(' | '));

    await browser.close();

    console.log('\n=== 测试结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
    if (fail > 0) process.exit(1);
}

main().catch(err => {
    console.error('💥 测试异常：', err.message, '\n', err.stack);
    process.exit(1);
});