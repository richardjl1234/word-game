#!/bin/bash
# Word Game 启动脚本
# 用法：
#   ./start.sh          前台启动（开发调试）
#   ./start.sh start    后台启动
#   ./start.sh stop     停止服务
#   ./start.sh status   查看状态
#   ./start.sh restart  重启服务

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
GAME_DIR="$PROJECT_DIR/game"
PORT="${PORT:-8080}"
PID_FILE="/tmp/word-game-server.pid"
LOG_FILE="/tmp/word-game-server.log"

is_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start_bg() {
    if is_running; then
        echo "❌ 服务已在运行 (PID $(cat "$PID_FILE"))"
        return 1
    fi
    nohup python3 -m http.server "$PORT" -d "$GAME_DIR" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1
    if is_running; then
        echo "✅ 服务已启动 (PID $(cat "$PID_FILE"))"
        print_usage
    else
        echo "❌ 启动失败，请查看日志: $LOG_FILE"
        return 1
    fi
}

stop_bg() {
    if ! is_running; then
        echo "❌ 服务未运行"
        rm -f "$PID_FILE"
        return 0
    fi
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    sleep 0.5
    echo "✅ 服务已停止"
}

status_bg() {
    if is_running; then
        echo "✅ 运行中 (PID $(cat "$PID_FILE"), 端口 $PORT)"
    else
        echo "❌ 未运行"
        return 1
    fi
}

print_usage() {
    cat <<EOF

🎮 英语单词闯关游戏

访问地址：http://localhost:$PORT/

📌 首次使用：
   - 直接打开链接即可开始游戏
   - 50 个关卡 + 错词复习关卡
   - 支持鼠标/触屏/游戏手柄（小胖2代）

🎯 关键操作：
   - 鼠标/触屏：点击上方英文单词气泡与底部中文释义匹配
   - 手柄：A 确认 / B 返回 / Start 或 X 暂停 / D-pad 切换焦点 / 左摇杆移动焦点

⚠️ 故障排查：
   - 端口占用：编辑此脚本顶部的 PORT 变量
   - 日志查看：tail -f $LOG_FILE
   - 强制停止：kill $(cat $PID_FILE 2>/dev/null) 2>/dev/null

EOF
}

case "${1:-}" in
    start)
        start_bg
        ;;
    stop)
        stop_bg
        ;;
    status)
        status_bg
        ;;
    restart)
        stop_bg
        start_bg
        ;;
    *)
        # 前台启动
        echo "🎮 启动 Word Game (前台模式，Ctrl+C 退出)..."
        print_usage
        cd "$GAME_DIR"
        exec python3 -m http.server "$PORT"
        ;;
esac