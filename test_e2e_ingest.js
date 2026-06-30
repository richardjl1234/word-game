/**
 * Playwright 端到端测试：文本文件 → 后端 pipeline → 词库入库
 *
 * 流程：
 *   1. 前端进入"导入词库"界面
 *   2. 选择 txt 文件
 *   3. 点击"开始导入"
 *   4. 等待 status 显示 ✅ 完成
 *   5. 验证目标词库已包含提取的单词
 *
 * 用法：
 *   - 启动后端: ./start.sh backend start
 *   - 启动前端: ./start.sh start  (port 8080)
 *   - 运行: node test_e2e_ingest.js
 */
const path = require('path');
const fs = require('fs');

const PW_PATH = '/home/richardjl/.npm-global/lib/node_modules/playwright';
const { chromium } = require(PW_PATH);

const FRONTEND_URL = 'http://localhost:8080/';
const BACKEND_URL = 'http://127.0.0.1:8765';

// 准备测试 txt 文件（含已知词典词 + lemma 测试词）
const FIXTURE_TXT = '/tmp/wordgame-e2e-sample.txt';
const SAMPLE_TEXT = [
    'I have three books and a red apple on the desk.',
    'The children were running quickly through the park.',
    'The cat ate the mouse and drank some water.',
    'My friend went to the library yesterday.',
    'There are five birds singing in the tree.',
].join('\n');
fs.writeFileSync(FIXTURE_TXT, SAMPLE_TEXT, 'utf-8');

const results = [];
function record(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
    console.log('\n=== 端到端测试：文本文件 → 后端 pipeline → 词库入库 ===\n');

    const browser = await chromium.launch({
        headless: true,
        executablePath: '/home/richardjl/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    const jsErrors = [];
    page.on('pageerror', e => jsErrors.push(e.message));
    page.on('console', msg => {
        if (msg.type() === 'error') jsErrors.push(msg.text());
    });

    // 0. 注册测试账号 + 拿 JWT（task #36 后所有 API 都需鉴权）
    const username = `ingest_${Date.now().toString(36)}`;
    const regResp = await page.request.post(`${BACKEND_URL}/api/auth/register`, {
        data: { username, password: 'test123456' },
        headers: { 'Content-Type': 'application/json' },
    });
    const regData = await regResp.json();
    const token = regData.token;
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    record('T0: 注册测试账号拿 JWT', !!token, `account=${regData.account?.id}`);

    // 1. 创建目标词库（用 JWT）
    const libResp = await page.request.post(`${BACKEND_URL}/api/libraries`, {
        data: { name: `E2E导入测试-${Date.now()}` },
        headers: authHeaders,
    });
    const libJson = await libResp.json();
    const libId = libJson.id;
    record('T1: 创建目标词库', !!libId, `lib_id=${libId?.slice(0, 8)}... status=${libResp.status()}`);

    // 2. 直接通过 API 上传文件 + 触发 pipeline（绕过前端 UI 简化测试）
    const fileBuf = fs.readFileSync(FIXTURE_TXT);
    const uploadResp = await page.request.post(`${BACKEND_URL}/api/upload`, {
        multipart: {
            file: { name: 'sample.txt', mimeType: 'text/plain', buffer: fileBuf },
            target_library_id: libId,
        },
        headers: { Authorization: `Bearer ${token}` },
    });
    if (uploadResp.status() !== 201) {
        record('T2: 上传文件', false, `status=${uploadResp.status()} body=${(await uploadResp.text()).slice(0, 200)}`);
    } else {
        const job = await uploadResp.json();
        record('T2: 上传文件', true, `job_id=${job.id.slice(0, 8)} status=${job.status}`);
        var jobId = job.id;
    }

    // 3. 轮询 job 状态（最多 60 次 × 1s = 60s）
    if (jobId) {
        let finalJob = null;
        for (let i = 0; i < 60; i++) {
            const r = await page.request.get(`${BACKEND_URL}/api/jobs/${jobId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            finalJob = await r.json();
            if (finalJob.status === 'completed' || finalJob.status === 'failed') break;
            await new Promise(r => setTimeout(r, 1000));
        }
        record('T3: pipeline 完成',
            finalJob && finalJob.status === 'completed',
            `status=${finalJob?.status}, stage=${finalJob?.current_stage}, progress=${finalJob?.progress}`
        );
        record('T4: 提取结果',
            finalJob?.result?.added_count > 0,
            `extracted=${finalJob?.result?.extracted_count}, known=${finalJob?.result?.known_count}, added=${finalJob?.result?.added_count}, unknown=${finalJob?.result?.unknown_count}`
        );

        // 4. 查询词库单词列表
        const wordsResp = await page.request.get(`${BACKEND_URL}/api/libraries/${libId}/words`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const wordsJson = await wordsResp.json();
        // API 返回裸数组 [{word, meaning, ...}, ...]
        const words = Array.isArray(wordsJson) ? wordsJson : (wordsJson.words || []);
        const wordSet = new Set(words.map(w => w.word));
        const hasBook = wordSet.has('book');      // books → book (lemma)
        const hasChild = wordSet.has('child');    // children → child
        const hasRun = wordSet.has('run');        // running → run (stop word filtered)
        const hasCat = wordSet.has('cat');
        const hasMouse = wordSet.has('mouse');
        const hasGo = wordSet.has('go');          // went → go
        const hasDrink = wordSet.has('drink');    // drank → drink
        const hasFive = wordSet.has('five');
        const hasBird = wordSet.has('bird');      // birds → bird
        const hasTree = wordSet.has('tree');
        const hasDesk = wordSet.has('desk');
        const noI = !wordSet.has('i');           // 停用词
        const noThe = !wordSet.has('the');

        record('T5: lemma books→book', hasBook, `words: ${[...wordSet].slice(0, 8).join(',')}...`);
        record('T6: lemma children→child', hasChild);
        record('T7: lemma went→go', hasGo);
        record('T8: lemma drank→drink', hasDrink);
        record('T9: lemma birds→bird', hasBird);
        record('T10: 普通词 cat/mouse/tree/desk 入库', hasCat && hasMouse && hasTree && hasDesk);
        record('T11: 停用词被过滤', noI && noThe);

        // 5. 验证至少部分 word 有 audio_en（占位 mp3）
        const wordsWithAudio = words.filter(w => w.audio_en);
        record('T12: 至少部分单词有 audio_en',
            wordsWithAudio.length > 0,
            `共 ${words.length} 词，${wordsWithAudio.length} 个有 audio_en`
        );
    }

    // 6. 前端 UI 烟测 — 进入导入界面，确认状态文本更新
    try {
        await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);
        const title = await page.title();
        record('T13: 前端加载', title.includes('教育魔法岛'), `title=${title}`);

        // 验证导入界面入口存在
        const importBtn = await page.$('#btn-import');
        record('T14: 导入按钮存在', !!importBtn);
    } catch (e) {
        record('T13: 前端加载', false, e.message);
    }

    // 7. 截图
    await page.screenshot({ path: '/tmp/e2e-ingest-final.png', fullPage: true });

    // 8. JS 错误检查
    record('T15: 前端无 JS 错误', jsErrors.length === 0,
        jsErrors.length === 0 ? '' : `errors=${jsErrors.slice(0, 3).join('; ')}`);

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
})().catch(e => {
    console.error('未捕获异常:', e);
    process.exit(1);
});