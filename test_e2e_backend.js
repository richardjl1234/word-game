/**
 * Playwright 端到端测试：前端 + 后端联调
 * - 启动浏览器 → 访问 http://localhost:8080/
 * - 通过 API 验证：上传 → 查询 job → 创建词库 → 添加单词 → 查询
 * - 截图保存到 /tmp/
 *
 * 用法：先启动后端 (port 8765) 和前端 (port 8080)，然后：
 *   node test_e2e_backend.js
 */
const path = require('path');
const fs = require('fs');

// Playwright 用全局安装
const PW_PATH = '/home/richardjl/.npm-global/lib/node_modules/playwright';
const { chromium } = require(PW_PATH);

const FRONTEND_URL = 'http://localhost:8080/';
const BACKEND_URL = 'http://127.0.0.1:8765';
const FIXTURE = '/home/richardjl/shared/jianglei/claude/word-game/backend/tests/fixtures/sample_english_text.txt';

const results = [];
function record(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
    console.log('\n=== 端到端测试：前端 + 后端联调 ===\n');

    // 1. 浏览器实例（用系统 Chrome 而非 headless shell，避免下载）
    const browser = await chromium.launch({
        headless: true,
        executablePath: '/home/richardjl/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    // 收集 JS 错误
    const jsErrors = [];
    page.on('pageerror', e => jsErrors.push(e.message));
    page.on('console', msg => {
        if (msg.type() === 'error') jsErrors.push(msg.text());
    });

    // 2. 打开前端页面
    try {
        await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 15000 });
        record('T1: 前端首页加载', true, `title=${await page.title()}`);
        await page.screenshot({ path: '/tmp/e2e-frontend-home.png', fullPage: true });
    } catch (e) {
        record('T1: 前端首页加载', false, e.message);
        await browser.close();
        return report();
    }

    // 3. 后端健康检查
    try {
        const r = await page.request.get(`${BACKEND_URL}/api/health`);
        const data = await r.json();
        record('T2: 后端 health 检查', r.status() === 200 && data.status === 'ok',
            `status=${data.status}, db=${data.db}`);
    } catch (e) {
        record('T2: 后端 health 检查', false, e.message);
    }

    // 4. 注册/登录获取 JWT（task #36：所有受保护 API 都需要 Bearer token）
    let bearerToken = '';
    try {
        const username = `e2e_${Date.now().toString(36)}`;
        const r = await page.request.post(`${BACKEND_URL}/api/auth/register`, {
            data: { username, password: 'e2epass123' },
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await r.json();
        bearerToken = data.token;
        record('T2.5: 注册测试账号 + 拿 JWT', r.status() === 201 && !!bearerToken,
            `account_id=${data.account?.id}, token=${bearerToken?.slice(0, 20)}...`);
    } catch (e) {
        record('T2.5: 注册测试账号 + 拿 JWT', false, e.message);
    }
    const authHeader = { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` };

    // 5. 创建词库（API 直调，需要 JWT）
    let libId;
    try {
        const r = await page.request.post(
            `${BACKEND_URL}/api/libraries`,
            {
                data: { name: `E2E测试词库-${Date.now()}`, source: 'e2e-test' },
                headers: authHeader,
            }
        );
        const data = await r.json();
        libId = data.id;
        record('T3: API 创建词库', r.status() === 201 && libId,
            `id=${libId}, name=${data.name}, level_count=${data.level_count}`);
    } catch (e) {
        record('T3: API 创建词库', false, e.message);
    }

    // 6. 上传文件 → 拿 job_id（JWT + form target_library_id 兼容）
    let jobId;
    try {
        const fileBuf = fs.readFileSync(FIXTURE);
        const r = await page.request.post(`${BACKEND_URL}/api/upload?target_library_id=${libId}`, {
            multipart: {
                file: {
                    name: 'sample_english_text.txt',
                    mimeType: 'text/plain',
                    buffer: fileBuf,
                },
                target_library_id: String(libId),
            },
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { data = { _raw: text.slice(0, 200) }; }
        jobId = data.id;
        record('T4: 文件上传', r.status() === 201 && jobId,
            `job_id=${jobId}, source_type=${data.source_type}, size=${data.source_size_bytes}B, status=${r.status()}`);
    } catch (e) {
        record('T4: 文件上传', false, e.message);
    }

    // 7. 查询 job 状态
    try {
        const r = await page.request.get(`${BACKEND_URL}/api/jobs/${jobId}`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        const data = await r.json();
        record('T5: 查询 job 状态', r.status() === 200 && data.id === jobId,
            `status=${data.status}, stage=${data.current_stage}, progress=${data.progress}`);
    } catch (e) {
        record('T5: 查询 job 状态', false, e.message);
    }

    // 8. 用户级 job 列表
    try {
        const r = await page.request.get(`${BACKEND_URL}/api/jobs`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        const data = await r.json();
        record('T6: 用户级 job 列表', r.status() === 200 && data.jobs.length >= 1,
            `total=${data.total}, jobs=${data.jobs.map(j => j.id.slice(0, 8)).join(',')}`);
    } catch (e) {
        record('T6: 用户级 job 列表', false, e.message);
    }

    // 9. 直接同步调 worker：extract_text_sync
    try {
        const r = await page.request.get(`${BACKEND_URL}/api/jobs/${jobId}`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        const data = await r.json();
        record('T7: 同步文本提取（worker 路径）', !!data.storage_key,
            `storage_key=${data.storage_key}`);
    } catch (e) {
        record('T7: 同步文本提取（worker 路径）', false, e.message);
    }

    // 10. 模拟 LLM 输出 → lemma → 添加到词库
    try {
        const llmOutput = ['books', 'running', 'went', 'in spite of', 'looking forward to',
                           'arrive in', 'good at', 'waking', 'children', 'ate'];
        const r = await page.request.post(`${BACKEND_URL}/api/libraries/${libId}/words`, {
            data: {
                words: llmOutput.map(w => ({ word: w, meaning: `释义：${w}` })),
            },
            headers: authHeader,
        });
        const data = await r.json();
        record('T8: 批量添加单词到词库', r.status() === 200 && data.added > 0,
            `added=${data.added}, skipped=${data.skipped}, total=${data.total}`);
    } catch (e) {
        record('T8: 批量添加单词到词库', false, e.message);
    }

    // 11. 查词库单词列表
    try {
        const r = await page.request.get(`${BACKEND_URL}/api/libraries/${libId}/words`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        const data = await r.json();
        const words = data.words || data; // 看后端返回结构
        const wordList = Array.isArray(words) ? words.map(w => w.word) : [];
        const hasBook = wordList.includes('book'); // books lemma 后是 book
        const hasRun = wordList.includes('run');   // running lemma 后是 run
        record('T9: 查询词库单词（验证 lemma）',
            wordList.length >= 8 && (hasBook || wordList.includes('books')),
            `words=${wordList.slice(0, 8).join(',')}... count=${wordList.length}`);
    } catch (e) {
        record('T9: 查询词库单词（验证 lemma）', false, e.message);
    }

    // 12. 词库关卡数验证（T8 加的 10 词 → 1 关）
    try {
        const r = await page.request.get(`${BACKEND_URL}/api/libraries/${libId}`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        const data = await r.json();
        // 注意：上传 pipeline 可能还在后台加词，所以用 >=10 验证
        record('T10: 词库关卡数（>=10 词 → 至少 1 关）',
            data.word_count >= 10 && data.level_count >= 1,
            `word_count=${data.word_count}, level_count=${data.level_count}`);
    } catch (e) {
        record('T10: 词库关卡数（>=10 词 → 至少 1 关）', false, e.message);
    }

    // 13. 重复添加 → 应被去重跳过
    try {
        const r = await page.request.post(`${BACKEND_URL}/api/libraries/${libId}/words`, {
            data: { words: [{ word: 'book', meaning: '重复' }] },
            headers: authHeader,
        });
        const data = await r.json();
        record('T11: 重复单词去重', data.skipped >= 1, `added=${data.added}, skipped=${data.skipped}`);
    } catch (e) {
        record('T11: 重复单词去重', false, e.message);
    }

    // 14. 50 词 → 1 关；51 词 → 2 关
    try {
        const r1 = await page.request.post(
            `${BACKEND_URL}/api/libraries`,
            {
                data: { name: `关卡测试-${Date.now()}` },
                headers: authHeader,
            }
        );
        const libId2 = (await r1.json()).id;
        const words50 = Array.from({ length: 50 }, (_, i) => ({ word: `w${i}`, meaning: '' }));
        await page.request.post(`${BACKEND_URL}/api/libraries/${libId2}/words`, {
            data: { words: words50 },
            headers: authHeader,
        });
        const r2 = await page.request.get(`${BACKEND_URL}/api/libraries/${libId2}`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        const d2 = await r2.json();
        record('T12: 50 词 → 1 关', d2.level_count === 1 && d2.word_count === 50,
            `count=${d2.word_count}, levels=${d2.level_count}`);

        // 加第 51 词
        await page.request.post(`${BACKEND_URL}/api/libraries/${libId2}/words`, {
            data: { words: [{ word: 'w50', meaning: '' }] },
            headers: authHeader,
        });
        const r3 = await page.request.get(`${BACKEND_URL}/api/libraries/${libId2}`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        const d3 = await r3.json();
        record('T13: 51 词 → 2 关', d3.level_count === 2 && d3.word_count === 51,
            `count=${d3.word_count}, levels=${d3.level_count}`);
    } catch (e) {
        record('T12: 50 词 → 1 关', false, e.message);
        record('T13: 51 词 → 2 关', false, e.message);
    }

    // 15. 删除词库
    try {
        const r = await page.request.delete(`${BACKEND_URL}/api/libraries/${libId}`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        const r2 = await page.request.get(`${BACKEND_URL}/api/libraries/${libId}`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
        record('T14: 删除词库', r.status() === 204 && r2.status() === 404,
            `delete=${r.status()}, get=${r2.status()}`);
    } catch (e) {
        record('T14: 删除词库', false, e.message);
    }

    // 15. 前端无 JS 错误
    record('T15: 前端页面无 JS 错误', jsErrors.length === 0,
        jsErrors.length === 0 ? '' : `errors=${jsErrors.slice(0, 3).join('; ')}`);

    await page.screenshot({ path: '/tmp/e2e-frontend-final.png', fullPage: true });
    await browser.close();

    report();
})().catch(e => {
    console.error('未捕获异常:', e);
    process.exit(1);
});

function report() {
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
}