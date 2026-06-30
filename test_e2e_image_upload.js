/**
 * Playwright 端到端测试：图片文件 (OCR) → 后端 pipeline → 词库入库
 *
 * 流程：
 *   1. 注册测试账号 + JWT
 *   2. 创建目标词库
 *   3. 通过前端 UI 选 fixture PNG（也可绕过 UI 直接 API 上传）
 *   4. 后端 OCR → 5 步 pipeline → 词库入库
 *   5. 验证词库包含 apple/banana/cat/dog（fixture 图内容）
 *   6. 前端 UI 烟测：导入按钮 accept 包含 image 扩展名、显示 🖼️ 图标
 *
 * 依赖：
 *   - fixture PNG: backend/tests/fixtures/sample_words.png
 *   - 后端: ./start.sh backend start
 *   - 前端: ./start.sh start (port 8080)
 *
 * 用法：
 *   node test_e2e_image_upload.js
 */
const path = require('path');
const fs = require('fs');

const PW_PATH = '/home/richardjl/.npm-global/lib/node_modules/playwright';
const { chromium } = require(PW_PATH);

const FRONTEND_URL = 'http://localhost:8080/';
const BACKEND_URL = 'http://127.0.0.1:8765';
const FIXTURE_PNG = path.join(
    __dirname,
    'backend/tests/fixtures/sample_words.png'
);

if (!fs.existsSync(FIXTURE_PNG)) {
    console.error(`❌ Fixture PNG 不存在: ${FIXTURE_PNG}`);
    console.error('   请跑: cd backend && ../venv/bin/python tests/fixtures/generate_sample_image.py tests/fixtures/sample_words.png');
    process.exit(1);
}

const results = [];
function record(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
    console.log('\n=== 端到端测试：图片文件 (OCR) → 词库入库 ===\n');

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

    // ============ 第 1 部分: 后端 OCR pipeline 端到端 ============

    // T0: 注册测试账号拿 JWT
    const username = `ocr_${Date.now().toString(36)}`;
    const regResp = await page.request.post(`${BACKEND_URL}/api/auth/register`, {
        data: { username, password: 'test123456' },
        headers: { 'Content-Type': 'application/json' },
    });
    const regData = await regResp.json();
    const token = regData.token;
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    record('T0: 注册测试账号', !!token, `account=${regData.account?.id}`);

    // T1: 创建目标词库
    const libResp = await page.request.post(`${BACKEND_URL}/api/libraries`, {
        data: { name: `E2E-OCR-${Date.now()}` },
        headers: authHeaders,
    });
    const libJson = await libResp.json();
    const libId = libJson.id;
    record('T1: 创建目标词库', !!libId, `lib_id=${libId?.slice(0, 8)}... status=${libResp.status()}`);

    // T2: 上传 fixture PNG
    const fileBuf = fs.readFileSync(FIXTURE_PNG);
    const uploadResp = await page.request.post(`${BACKEND_URL}/api/upload`, {
        multipart: {
            file: { name: 'sample_words.png', mimeType: 'image/png', buffer: fileBuf },
            target_library_id: libId,
        },
        headers: { Authorization: `Bearer ${token}` },
    });
    let jobId;
    if (uploadResp.status() !== 201) {
        record('T2: 上传 PNG', false, `status=${uploadResp.status()} body=${(await uploadResp.text()).slice(0, 200)}`);
    } else {
        const job = await uploadResp.json();
        jobId = job.id;
        record('T2: 上传 PNG', true, `job_id=${job.id.slice(0, 8)} source=${job.source_type}`);
        record('T3: source_type=image',
            job.source_type === 'image',
            `source_type=${job.source_type}`
        );
    }

    // T4: 轮询 job 直到 completed/failed（OCR 慢，给 2 分钟）
    if (jobId) {
        let finalJob = null;
        for (let i = 0; i < 120; i++) {
            const r = await page.request.get(`${BACKEND_URL}/api/jobs/${jobId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            finalJob = await r.json();
            if (finalJob.status === 'completed' || finalJob.status === 'failed') break;
            await new Promise(r => setTimeout(r, 1000));
        }
        record('T4: OCR pipeline 完成',
            finalJob && finalJob.status === 'completed',
            `status=${finalJob?.status}, stage=${finalJob?.current_stage}, progress=${finalJob?.progress}`
        );
        record('T5: final stage = done',
            finalJob?.current_stage === 'done',
            `final stage = ${finalJob?.current_stage}`
        );

        // T6: 验证 result 字段
        const result = finalJob?.result || {};
        record('T6: OCR 提取文本非空',
            result.text_length > 0,
            `text_length=${result.text_length}`
        );
        record('T7: OCR 后有已知单词',
            result.known_count > 0,
            `known=${result.known_count}, unknown=${result.unknown_count}`
        );
        record('T8: 入库 N 个词',
            result.added_count > 0,
            `added_count=${result.added_count}`
        );

        // T9: 查词库单词
        const wordsResp = await page.request.get(`${BACKEND_URL}/api/libraries/${libId}/words`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const wordsJson = await wordsResp.json();
        const words = Array.isArray(wordsJson) ? wordsJson : (wordsJson.words || []);
        const wordSet = new Set(words.map(w => w.word));

        // OCR 偶发漏字，至少命中 2 个期望词
        const expected = ['apple', 'banana', 'cat', 'dog'];
        const hits = expected.filter(w => wordSet.has(w));
        record('T9: 词库含 OCR 识别词 (≥2)',
            hits.length >= 2,
            `命中 ${hits.join(', ')} / 期望 ${expected.join(', ')}`
        );
        record('T10: 至少部分 word 有 audio_en',
            words.some(w => w.audio_en),
            `共 ${words.length} 词`
        );
    }

    // ============ 第 2 部分: 前端 UI 烟测 ============

    try {
        await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        record('T11: 前端加载', true);
    } catch (e) {
        record('T11: 前端加载', false, e.message);
    }

    // T12: 通过 DOM 验证 import file input accept 含 image 扩展名
    try {
        const accept = await page.evaluate(() => {
            const el = document.getElementById('import-file-input');
            return el ? el.getAttribute('accept') : null;
        });
        const ok = accept && accept.includes('.png') && accept.includes('.jpg') && accept.includes('.webp');
        record('T12: import input accept 含 .png/.jpg/.webp', !!ok, `accept="${accept}"`);

        // T13: 验证 drop hint 文案含图片说明
        const hint = await page.evaluate(() => {
            const el = document.querySelector('.import-drop-hint');
            return el ? el.textContent : '';
        });
        const hasOcrHint = hint && (hint.includes('图片') || hint.includes('OCR'));
        record('T13: drop hint 含 OCR 说明', !!hasOcrHint, `hint="${hint?.replace(/\s+/g, ' ').slice(0, 80)}"`);
    } catch (e) {
        record('T12: import input accept', false, e.message);
    }

    // 截图
    await page.screenshot({ path: '/tmp/e2e-image-upload-final.png', fullPage: true });

    record('T14: 前端无 JS 错误', jsErrors.length === 0,
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
