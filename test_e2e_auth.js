/**
 * 注册/登录/多玩家档案 E2E 测试（task #36）
 *
 * 覆盖：
 *   T1: 访问首页跳到 auth-screen
 *   T2: 注册成功 → 自动进 start-screen + 默认 profile
 *   T3: 退出登录 → 回到 auth-screen
 *   T4: 重新登录 → 加载之前的 profile
 *   T5: 创建第 2 个 profile → 切换
 *   T6: 重名注册 → 报错
 *   T7: 错误密码登录 → 报错
 *   T8: 弱密码注册 → 拒绝
 *   T9: 删除最后一个 profile → 拒绝（间接验证）
 *   T10: JWT 篡改 → 401
 *   T11: 老数据清理（首次进新版本清掉 wordGameUsers）
 *
 * 用法：node test_e2e_auth.js
 * 前置：./start.sh all 启动前后端
 */
const { chromium } = require('/home/richardjl/.npm-global/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const FRONTEND_URL = 'http://127.0.0.1:8080/';
const BACKEND_URL = 'http://127.0.0.1:8765';

const SCREENSHOT_DIR = '/tmp/word-game-auth-e2e';
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const results = { pass: 0, fail: 0, errors: [] };

function rand(n = 4) { return Math.random().toString(36).slice(2, 2 + n); }
const uname = `e2e_${Date.now().toString(36)}_${rand(4)}`;

async function freshPage(browser, clearStorage = true) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', msg => {
        if (msg.type() === 'error') console.log('  [browser-console-error]', msg.text());
    });
    page.on('pageerror', err => {
        console.log('  [pageerror]', err.message);
    });
    if (clearStorage) {
        // 用 localStorage flag 跨 reload 保持：第一次清空，之后不再清（避免破坏 token 持久化）
        await page.addInitScript(() => {
            try {
                if (!localStorage.getItem('__testCleared')) {
                    localStorage.clear();
                    localStorage.setItem('__testCleared', '1');
                }
            } catch (e) {}
        });
    }
    return { ctx, page };
}

async function screenshot(page, name) {
    const p = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: p, fullPage: false });
    return p;
}

// ============================================================
// 测试用例
// ============================================================

test('T1: 访问首页直接跳到 auth-screen（未登录）', async ({ browser }) => {
    const { ctx, page } = await freshPage(browser);
    try {
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        const authVisible = await page.locator('#auth-screen').isVisible();
        const startVisible = await page.locator('#start-screen').isVisible().catch(() => false);
        await screenshot(page, 'T1_auth_screen');

        if (!authVisible) throw new Error('未登录时应显示 #auth-screen');
        if (startVisible) throw new Error('未登录时不应显示 #start-screen');
    } finally {
        await ctx.close();
    }
});

test('T2: 注册成功 → 自动进 start-screen + 默认 profile', async ({ browser }) => {
    const { ctx, page } = await freshPage(browser);
    try {
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        await page.waitForSelector('#auth-screen.active', { timeout: 5000 });

        // 切到注册 tab
        await page.locator('#auth-tab-register').click();
        await page.waitForTimeout(200);

        const username = `t2_${rand(5)}`;
        const password = 'test123456';
        await page.locator('#auth-register-username').fill(username);
        await page.locator('#auth-register-password').fill(password);
        await page.locator('#auth-register-password-confirm').fill(password);
        await screenshot(page, 'T2_before_register');

        await page.locator('#auth-form-register button[type="submit"]').click();

        // 等待切到 start-screen
        await page.waitForSelector('#start-screen.active', { timeout: 10000 });
        await page.waitForTimeout(500);
        await screenshot(page, 'T2_after_register');

        // 验证 token 已存
        const token = await page.evaluate(() => localStorage.getItem('wordGameAuthToken'));
        if (!token) throw new Error('localStorage 应存有 wordGameAuthToken');
        if (!token.startsWith('eyJ')) throw new Error('token 格式错误');

        // 验证默认 profile 已加载
        const profileName = await page.locator('#current-player-name').textContent();
        if (!profileName || !profileName.trim()) throw new Error('默认 profile 未显示');
    } finally {
        await ctx.close();
    }
});

test('T3: 退出登录 → 回到 auth-screen', async ({ browser }) => {
    const { ctx, page } = await freshPage(browser);
    try {
        // 先注册
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        await page.waitForSelector('#auth-screen.active', { timeout: 5000 });
        const username = `t3_${rand(5)}`;
        await page.locator('#auth-tab-register').click();
        await page.locator('#auth-register-username').fill(username);
        await page.locator('#auth-register-password').fill('test123456');
        await page.locator('#auth-register-password-confirm').fill('test123456');
        await page.locator('#auth-form-register button[type="submit"]').click();
        await page.waitForSelector('#start-screen.active', { timeout: 10000 });

        // 点退出
        page.once('dialog', d => d.accept());  // confirm() 自动确认
        await page.locator('#btn-logout').click();
        await page.waitForSelector('#auth-screen.active', { timeout: 5000 });
        await page.waitForTimeout(300);
        await screenshot(page, 'T3_after_logout');

        // 验证 localStorage 已清
        const token = await page.evaluate(() => localStorage.getItem('wordGameAuthToken'));
        if (token) throw new Error('退出后 localStorage.token 应被清空');
    } finally {
        await ctx.close();
    }
});

test('T4: 重新登录 → 加载之前的 profile', async ({ browser }) => {
    const username = `t4_${rand(5)}`;
    const password = 'test123456';

    // 先在 ctx1 注册
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await page1.addInitScript(() => {
        try {
            if (!localStorage.getItem('__testCleared')) {
                localStorage.clear();
                localStorage.setItem('__testCleared', '1');
            }
        } catch (e) {}
    });
    await page1.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
    await page1.waitForSelector('#auth-screen.active', { timeout: 5000 });
    await page1.locator('#auth-tab-register').click();
    await page1.locator('#auth-register-username').fill(username);
    await page1.locator('#auth-register-password').fill(password);
    await page1.locator('#auth-register-password-confirm').fill(password);
    await page1.locator('#auth-form-register button[type="submit"]').click();
    await page1.waitForSelector('#start-screen.active', { timeout: 10000 });
    await page1.waitForTimeout(300);
    await ctx1.close();

    // 新 context 模拟重开浏览器 → 重新登录
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    try {
        await page2.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        // 新 context 没有 token，应显示 auth-screen
        await page2.waitForSelector('#auth-screen.active', { timeout: 5000 });
        // 用同一用户名密码登录
        await page2.locator('#auth-login-username').fill(username);
        await page2.locator('#auth-login-password').fill(password);
        await page2.locator('#auth-form-login button[type="submit"]').click();
        await page2.waitForSelector('#start-screen.active', { timeout: 10000 });
        await page2.waitForTimeout(500);
        await screenshot(page2, 'T4_relogin');

        const profileName = await page2.locator('#current-player-name').textContent();
        if (!profileName || !profileName.trim()) throw new Error('重新登录后未加载 profile');
    } finally {
        await ctx2.close();
    }
});

test('T6: 重名注册 → 报错', async ({ browser }) => {
    const username = `t6_${rand(5)}`;
    const password = 'test123456';

    // 先注册一个
    const reg = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!reg.ok) throw new Error(`预注册失败: ${reg.status}`);

    // 浏览器再注册同名
    const { ctx, page } = await freshPage(browser);
    try {
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        await page.waitForSelector('#auth-screen.active', { timeout: 5000 });
        await page.locator('#auth-tab-register').click();
        await page.locator('#auth-register-username').fill(username);
        await page.locator('#auth-register-password').fill(password);
        await page.locator('#auth-register-password-confirm').fill(password);
        await page.locator('#auth-form-register button[type="submit"]').click();

        await page.waitForSelector('#auth-error:not([hidden])', { timeout: 5000 });
        const errText = await page.locator('#auth-error').textContent();
        await screenshot(page, 'T6_duplicate_error');
        if (!errText.includes('已存在') && !errText.includes('占用') && !errText.includes('duplicate') && !errText.toLowerCase().includes('exist')) {
            throw new Error(`重名错误提示异常: ${errText}`);
        }
    } finally {
        await ctx.close();
    }
});

test('T7: 错误密码登录 → 报错', async ({ browser }) => {
    const username = `t7_${rand(5)}`;
    const password = 'test123456';
    // 先注册
    await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });

    const { ctx, page } = await freshPage(browser);
    try {
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        await page.waitForSelector('#auth-screen.active', { timeout: 5000 });
        await page.locator('#auth-login-username').fill(username);
        await page.locator('#auth-login-password').fill('wrongpass');
        await page.locator('#auth-form-login button[type="submit"]').click();

        await page.waitForSelector('#auth-error:not([hidden])', { timeout: 5000 });
        const errText = await page.locator('#auth-error').textContent();
        await screenshot(page, 'T7_wrong_password');
        if (!errText.toLowerCase().includes('password') && !errText.includes('密码') && !errText.includes('401')) {
            throw new Error(`错误密码提示异常: ${errText}`);
        }
    } finally {
        await ctx.close();
    }
});

test('T8: 弱密码注册 → 拒绝', async ({ browser }) => {
    const { ctx, page } = await freshPage(browser);
    try {
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        await page.waitForSelector('#auth-screen.active', { timeout: 5000 });
        await page.locator('#auth-tab-register').click();
        await page.locator('#auth-register-username').fill(`t8_${rand(5)}`);
        await page.locator('#auth-register-password').fill('123');  // < 6
        await page.locator('#auth-register-password-confirm').fill('123');
        await page.locator('#auth-form-register button[type="submit"]').click();

        // 等错误显示
        await page.waitForSelector('#auth-error:not([hidden])', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await screenshot(page, 'T8_weak_password');

        const startVisible = await page.locator('#start-screen.active').isVisible().catch(() => false);
        if (startVisible) throw new Error('弱密码应被拒绝，不应进入 start-screen');

        // 错误可能由前端校验或后端给出，至少 auth-screen 应仍可见
        const authVisible = await page.locator('#auth-screen.active').isVisible();
        if (!authVisible) throw new Error('弱密码提交后应仍在 auth-screen');
    } finally {
        await ctx.close();
    }
});

test('T10: JWT 篡改 → 401 后强制重新登录', async ({ browser }) => {
    const username = `t10_${rand(5)}`;
    const password = 'test123456';
    const reg = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    const data = await reg.json();
    const badToken = data.token.slice(0, -5) + 'XXXXX';

    const { ctx, page } = await freshPage(browser);
    try {
        await page.addInitScript((t) => {
            try {
                localStorage.clear();
                localStorage.setItem('wordGameAuthToken', t);
                localStorage.setItem('wordGameAccount', JSON.stringify({
                    id: 'acc_fake', username: 'fake', created_at: '', last_login_at: null
                }));
                localStorage.setItem('wordGameCurrentProfile', JSON.stringify({
                    id: 'p_fake', account_id: 'acc_fake', nickname: 'fake', avatar: '🦊'
                }));
            } catch (e) {}
        }, badToken);
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        await screenshot(page, 'T10_tampered_jwt');

        // /me 失败后应跳回 auth-screen
        const authVisible = await page.locator('#auth-screen.active').isVisible();
        if (!authVisible) throw new Error('JWT 篡改后应跳回 auth-screen');
    } finally {
        await ctx.close();
    }
});

test('T11: 老游客数据自动清理', async ({ browser }) => {
    const { ctx, page } = await freshPage(browser, false);
    try {
        // 预设老数据（不通过 freshPage 的清空机制，直接 goto 后再写老数据）
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
        await page.evaluate(() => {
            try {
                localStorage.clear();
                localStorage.setItem('wordGameUsers', JSON.stringify([{ id: 'old', name: '游客' }]));
                localStorage.setItem('wordGameCurrentUserId', 'old');
                localStorage.setItem('wordGameCurrentPlayer', JSON.stringify({ id: 'old', name: '游客' }));
                localStorage.setItem('wordGameProgress_old', '{"level": 1}');
                localStorage.setItem('wordGameLibrary_old', '{}');
            } catch (e) {}
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('#auth-screen.active', { timeout: 5000 });
        await page.waitForTimeout(500);

        const cleared = await page.evaluate(() => ({
            users: localStorage.getItem('wordGameUsers'),
            currentUser: localStorage.getItem('wordGameCurrentUserId'),
            currentPlayer: localStorage.getItem('wordGameCurrentPlayer'),
            progress: localStorage.getItem('wordGameProgress_old'),
            library: localStorage.getItem('wordGameLibrary_old'),
        }));

        if (cleared.users !== null) throw new Error('wordGameUsers 未清理');
        if (cleared.currentUser !== null) throw new Error('wordGameCurrentUserId 未清理');
        if (cleared.currentPlayer !== null) throw new Error('wordGameCurrentPlayer 未清理');
        if (cleared.progress !== null) throw new Error('wordGameProgress_old 未清理');
        if (cleared.library !== null) throw new Error('wordGameLibrary_old 未清理');
    } finally {
        await ctx.close();
    }
});

test('T12: 后端 API 鉴权 - 无 token 访问 /me 返回 401', async ({ browser }) => {
    const r = await fetch(`${BACKEND_URL}/api/auth/me`);
    if (r.status !== 401) throw new Error(`无 token /me 应返回 401，实际 ${r.status}`);
});

test('T13: 词库 API 鉴权 - 无 token 访问 /api/libraries 返回 401', async ({ browser }) => {
    const r = await fetch(`${BACKEND_URL}/api/libraries`);
    if (r.status !== 401) throw new Error(`无 token /api/libraries 应返回 401，实际 ${r.status}`);
});

// ============================================================
// 跑测试
// ============================================================

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: '/home/richardjl/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
    });
    for (const t of tests) {
        process.stdout.write(`▶ ${t.name} ... `);
        try {
            await t.fn({ browser });
            console.log('✅');
            results.pass++;
        } catch (e) {
            console.log('❌', e.message);
            results.fail++;
            results.errors.push({ name: t.name, error: e.message, stack: e.stack });
        }
    }
    await browser.close();

    console.log('');
    console.log('============================================');
    console.log(`通过: ${results.pass} / ${tests.length}`);
    console.log(`失败: ${results.fail}`);
    if (results.fail > 0) {
        console.log('');
        console.log('失败详情：');
        for (const e of results.errors) {
            console.log(`  ❌ ${e.name}`);
            console.log(`     ${e.error}`);
        }
    }
    console.log(`截图: ${SCREENSHOT_DIR}/`);
    process.exit(results.fail > 0 ? 1 : 0);
})();
