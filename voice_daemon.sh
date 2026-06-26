#!/usr/bin/env bash
# 看门狗：确保 generate_voices.py 一直在后台跑
# 用法：
#   ./voice_daemon.sh start    # 启动（如果已在跑则提示）
#   ./voice_daemon.sh stop     # 停止
#   ./voice_daemon.sh status   # 查看进度
#   ./voice_daemon.sh log      # tail 日志
#   ./voice_daemon.sh follow   # 持续监控（每 60s 打印一次进度，Ctrl+C 退出）
set -e

cd "$(dirname "$0")"
PID_FILE=logs/voice_daemon.pid
LOG_FILE=logs/voice_daemon.log
STATE_FILE=game/sounds/.generation_state.json

is_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

do_start() {
    if is_running; then
        echo "⚠️  已在运行 (PID $(cat "$PID_FILE"))"
        ./voice_daemon.sh status
        return 0
    fi
    mkdir -p logs
    # 解析 --force / --no-force 等透传给 generate_voices.py
    local extra_args=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --force|--retry-errors|--no-resume-failed) extra_args+=("$1") ;;
            *) echo "  (忽略未知参数: $1)" ;;
        esac
        shift
    done
    # setsid + nohup 让进程脱离 session
    setsid nohup bash -c "source /home/richardjl/shared/jianglei/claude/education_config.sh && python3 -u generate_voices.py --rate=1.5 --workers=1 --daily-quota=4000 ${extra_args[*]} 2>&1" \
        > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    disown 2>/dev/null || true
    sleep 2
    if is_running; then
        echo "✅ 已启动 (PID $(cat "$PID_FILE"))，日志: $LOG_FILE"
        [ ${#extra_args[@]} -gt 0 ] && echo "   透传参数: ${extra_args[*]}"
    else
        echo "❌ 启动失败，看日志: $LOG_FILE"
        tail -20 "$LOG_FILE"
        return 1
    fi
}

do_stop() {
    if ! is_running; then
        echo "(未在运行)"
        rm -f "$PID_FILE"
        return 0
    fi
    PID=$(cat "$PID_FILE")
    echo "🛑 停止 PID $PID ..."
    kill -TERM "$PID" 2>/dev/null || true
    # 等最多 10s 让它落盘
    for i in 1 2 3 4 5 6 7 8 9 10; do
        if ! kill -0 "$PID" 2>/dev/null; then break; fi
        sleep 1
    done
    if kill -0 "$PID" 2>/dev/null; then
        echo "   强杀 ..."
        kill -KILL "$PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    echo "✅ 已停止"
}

do_status() {
    if is_running; then
        PID=$(cat "$PID_FILE")
        echo "🟢 运行中 (PID $PID)"
    else
        echo "🔴 未运行"
        return 0
    fi
    if [ ! -f "$STATE_FILE" ]; then
        echo "(无进度)"
        return 0
    fi
    python3 - <<PY
import json, time
s = json.loads(open("$STATE_FILE").read())
e, z = len(s['en']['completed']), len(s['zh']['completed'])
ef, zf = len(s['en']['failed']), len(s['zh']['failed'])
t = e + z
total = 5433
print(f"  已完成: {t}/{total} ({100*t/total:.1f}%)")
print(f"  失败: {ef+zf}")
print(f"  今日调用: {s.get('daily_count')}/4000")
print(f"  最近一次: {s.get('last_run')}")
PY
}

do_log() {
    tail -f "$LOG_FILE"
}

do_follow() {
    while true; do
        clear
        echo "===== $(date '+%Y-%m-%d %H:%M:%S') ====="
        if is_running; then
            echo "PID: $(cat "$PID_FILE")"
        else
            echo "🔴 进程已停止"
        fi
        if [ -f "$STATE_FILE" ]; then
            python3 - <<PY
import json, time
s = json.loads(open("$STATE_FILE").read())
e, z = len(s['en']['completed']), len(s['zh']['completed'])
ef, zf = len(s['en']['failed']), len(s['zh']['failed'])
t = e + z
total = 5433
pct = 100*t/total
bar_len = 40
filled = int(pct/100*bar_len)
bar = '█' * filled + '░' * (bar_len-filled)
print(f"[{bar}] {pct:.1f}% ({t}/{total})")
print(f"英文: {e}  中文: {z}  失败: {ef+zf}  今日调用: {s.get('daily_count')}/4000")
PY
        fi
        echo "(Ctrl+C 退出监控)"
        sleep 60
    done
}

case "${1:-status}" in
    start)  do_start ;;
    stop)   do_stop ;;
    status) do_status ;;
    log)    do_log ;;
    follow) do_follow ;;
    restart) do_stop; do_start ;;
    *)
        echo "用法: $0 {start|stop|status|log|follow|restart}"
        exit 1
        ;;
esac
