#!/bin/bash
# Word Game 启动脚本（前端 + 后端）
# 用法：
#   ./start.sh                  前台启动前端（开发调试）
#   ./start.sh start            后台启动前端
#   ./start.sh stop             停止前端
#   ./start.sh status           查看前端状态
#   ./start.sh restart          重启前端
#
#   ./start.sh backend          前台启动后端 (port 8765)
#   ./start.sh backend start    后台启动后端
#   ./start.sh backend stop     停止后端
#   ./start.sh backend status   查看后端状态
#   ./start.sh backend restart  重启后端
#
#   ./start.sh all              同时启动前端 + 后端
#   ./start.sh all stop         同时停止

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
GAME_DIR="$PROJECT_DIR/game"
BACKEND_DIR="$PROJECT_DIR/backend"

# ============================================================
# 加载项目统一配置（{project_root}/../word-game_config.sh）
# 应用必须从环境变量读密钥；启动时 source 此文件以注入 env。
# 缺失不强制（打 warning），让 dev 默认值兜底，避免阻塞首次启动。
# ============================================================
PROJECT_CONFIG_SH="$PROJECT_DIR/../word-game_config.sh"
if [ -f "$PROJECT_CONFIG_SH" ]; then
    # shellcheck disable=SC1090
    source "$PROJECT_CONFIG_SH"
else
    echo "⚠️  未找到 $PROJECT_CONFIG_SH"
    echo "   应用将从系统环境变量读取配置；缺失时使用 dev 默认值"
    echo "   创建方法: cp {project_root}/../word-game_config.sh.example 同名文件并填入密钥"
fi

# 前端配置
FRONTEND_PORT="${FRONTEND_PORT:-8080}"
FRONTEND_PID_FILE="/tmp/word-game-server.pid"
FRONTEND_LOG_FILE="/tmp/word-game-server.log"

# 后端配置
BACKEND_PORT="${BACKEND_PORT:-8765}"
BACKEND_PID_FILE="/tmp/word-game-backend.pid"
BACKEND_LOG_FILE="/tmp/word-game-backend.log"
VENV_PY="$PROJECT_DIR/venv/bin/python"

# ============================================================
# 通用函数
# ============================================================

is_running() {
    local pid_file="$1"
    [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

# ============================================================
# 前端
# ============================================================

frontend_start_bg() {
    if is_running "$FRONTEND_PID_FILE"; then
        echo "❌ 前端已在运行 (PID $(cat "$FRONTEND_PID_FILE"))"
        return 1
    fi
    # 确保 config.js 存在（避免 404 + soundManager 拿不到 voice 配置）
    if [ ! -f "$GAME_DIR/js/config.js" ]; then
        if [ -f "$GAME_DIR/js/config.example.js" ]; then
            cp "$GAME_DIR/js/config.example.js" "$GAME_DIR/js/config.js"
            echo "📝 已从 config.example.js 创建 config.js（不含 API Key，仅占位）"
            echo "   如需重新生成语音，编辑此文件填入真实 API Key"
        else
            echo "⚠️  警告: config.example.js 不存在，无法创建 config.js"
        fi
    fi
    nohup python3 -m http.server "$FRONTEND_PORT" -d "$GAME_DIR" > "$FRONTEND_LOG_FILE" 2>&1 &
    echo $! > "$FRONTEND_PID_FILE"
    sleep 1
    if is_running "$FRONTEND_PID_FILE"; then
        echo "✅ 前端已启动 (PID $(cat "$FRONTEND_PID_FILE"))，端口 $FRONTEND_PORT"
    else
        echo "❌ 前端启动失败，请查看日志: $FRONTEND_LOG_FILE"
        return 1
    fi
}

frontend_stop_bg() {
    if ! is_running "$FRONTEND_PID_FILE"; then
        echo "❌ 前端未运行"
        rm -f "$FRONTEND_PID_FILE"
        return 0
    fi
    kill "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null || true
    rm -f "$FRONTEND_PID_FILE"
    sleep 0.5
    echo "✅ 前端已停止"
}

frontend_status() {
    if is_running "$FRONTEND_PID_FILE"; then
        echo "✅ 前端运行中 (PID $(cat "$FRONTEND_PID_FILE"), 端口 $FRONTEND_PORT)"
    else
        echo "❌ 前端未运行"
        return 1
    fi
}

# ============================================================
# 后端
# ============================================================

backend_check() {
    # 确保 venv 存在
    if [ ! -x "$VENV_PY" ]; then
        echo "❌ venv 不存在: $VENV_PY"
        echo "   创建: cd $PROJECT_DIR && python3.12 -m venv venv"
        echo "   安装依赖: $VENV_PY -m pip install -r $BACKEND_DIR/requirements.txt"
        return 1
    fi
    return 0
}

backend_start_bg() {
    backend_check || return 1
    if is_running "$BACKEND_PID_FILE"; then
        echo "❌ 后端已在运行 (PID $(cat "$BACKEND_PID_FILE"))"
        return 1
    fi
    # 默认 dev 配置：sqlite + LocalStorage
    export DATABASE_URL="${DATABASE_URL:-sqlite:////tmp/wordgame-backend.db}"
    export STORAGE_BACKEND="${STORAGE_BACKEND:-local}"
    export LOCAL_STORAGE_DIR="${LOCAL_STORAGE_DIR:-/tmp/wordgame-backend-storage}"
    export APP_DEBUG="${APP_DEBUG:-true}"

    cd "$BACKEND_DIR"
    # ★ 绑 0.0.0.0 而不是 127.0.0.1（让局域网其他机器可访问 — 见 TD-011）
    nohup "$VENV_PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" \
        --app-dir "$BACKEND_DIR" --log-level info \
        > "$BACKEND_LOG_FILE" 2>&1 &
    echo $! > "$BACKEND_PID_FILE"
    cd "$PROJECT_DIR"
    sleep 2
    if is_running "$BACKEND_PID_FILE"; then
        echo "✅ 后端已启动 (PID $(cat "$BACKEND_PID_FILE"))，端口 $BACKEND_PORT"
        echo "   健康检查: curl http://127.0.0.1:$BACKEND_PORT/api/health"
        echo "   数据库: $DATABASE_URL"
        echo "   Storage: $STORAGE_BACKEND ($LOCAL_STORAGE_DIR)"
    else
        echo "❌ 后端启动失败，请查看日志: $BACKEND_LOG_FILE"
        return 1
    fi
}

backend_stop_bg() {
    if ! is_running "$BACKEND_PID_FILE"; then
        echo "❌ 后端未运行"
        rm -f "$BACKEND_PID_FILE"
        return 0
    fi
    kill "$(cat "$BACKEND_PID_FILE")" 2>/dev/null || true
    rm -f "$BACKEND_PID_FILE"
    sleep 0.5
    echo "✅ 后端已停止"
}

backend_status() {
    if is_running "$BACKEND_PID_FILE"; then
        echo "✅ 后端运行中 (PID $(cat "$BACKEND_PID_FILE"), 端口 $BACKEND_PORT)"
    else
        echo "❌ 后端未运行"
        return 1
    fi
}

# ============================================================
# 统一入口
# ============================================================

print_usage() {
    cat <<EOF

🎮 英语单词闯关游戏（含多词库后端）

访问地址：
   前端：http://localhost:$FRONTEND_PORT/
   后端：http://127.0.0.1:$BACKEND_PORT/
   健康检查：curl http://127.0.0.1:$BACKEND_PORT/api/health

📌 首次使用：
   1. ./start.sh all              同时启动前端 + 后端
   2. 浏览器打开 http://localhost:$FRONTEND_PORT/ 开始游戏
   3. 词库管理界面（开始界面右上角）可创建/切换词库

🎯 关键操作：
   - 鼠标/触屏：点击上方英文单词气泡与底部中文释义匹配
   - 手柄：A 确认 / B 返回 / Start 或 X 暂停 / D-pad 切换焦点 / 左摇杆移动焦点
   - 文件上传 → 自动生成词库：上传 PDF/DOCX/TXT 文件后由后端处理（pipeline 当前仅 text_extract + lemma；ASR/LLM/TTS 待选型）

⚠️ 故障排查：
   - 端口占用：编辑此脚本顶部的 FRONTEND_PORT / BACKEND_PORT 变量
   - 日志：tail -f $FRONTEND_LOG_FILE  /  tail -f $BACKEND_LOG_FILE
   - 强制停止：kill \$(cat $FRONTEND_PID_FILE 2>/dev/null) 2>/dev/null
   - 后端测试：cd backend && ../venv/bin/python -m pytest tests/ -v
   - 前端 E2E：node test_e2e_backend.js（需前后端都跑起来）

📚 文档：
   - 后端 README：$BACKEND_DIR/README.md
   - 实施计划：~/.claude/plans/i-need-to-create-sunny-moon.md

EOF
}

# 入口分发
target="${1:-}"
action="${2:-}"

case "$target" in
    "")
        # 默认前台启动前端
        echo "🎮 启动 Word Game 前端 (前台模式，Ctrl+C 退出)..."
        print_usage
        cd "$GAME_DIR"
        exec python3 -m http.server "$FRONTEND_PORT"
        ;;
    all)
        case "$action" in
            stop)
                frontend_stop_bg || true
                backend_stop_bg || true
                ;;
            start|"")
                frontend_start_bg
                backend_start_bg
                print_usage
                ;;
            *)
                echo "用法: $0 all [start|stop]"
                exit 1
                ;;
        esac
        ;;
    backend)
        case "$action" in
            start)
                backend_start_bg
                ;;
            stop)
                backend_stop_bg
                ;;
            status)
                backend_status
                ;;
            restart)
                backend_stop_bg
                backend_start_bg
                ;;
            "")
                # 前台启动
                backend_check || exit 1
                export DATABASE_URL="${DATABASE_URL:-sqlite:////tmp/wordgame-backend.db}"
                export STORAGE_BACKEND="${STORAGE_BACKEND:-local}"
                export LOCAL_STORAGE_DIR="${LOCAL_STORAGE_DIR:-/tmp/wordgame-backend-storage}"
                export APP_DEBUG="${APP_DEBUG:-true}"
                echo "🔧 启动 Word Game 后端 (前台模式，Ctrl+C 退出)..."
                echo "   端口: $BACKEND_PORT"
                print_usage
                cd "$BACKEND_DIR"
                exec "$VENV_PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" \
                    --app-dir "$BACKEND_DIR" --reload
                ;;
            *)
                echo "用法: $0 backend [start|stop|status|restart]"
                exit 1
                ;;
        esac
        ;;
    start)
        frontend_start_bg
        print_usage
        ;;
    stop)
        frontend_stop_bg
        ;;
    status)
        frontend_status
        backend_status || true
        ;;
    restart)
        frontend_stop_bg
        frontend_start_bg
        ;;
    *)
        echo "用法: $0 [start|stop|status|restart] | $0 backend [start|stop|status|restart] | $0 all [start|stop]"
        exit 1
        ;;
esac