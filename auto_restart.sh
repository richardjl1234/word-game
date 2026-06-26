#!/usr/bin/env bash
# 自动续跑看门狗：每 15 分钟执行一次
# 逻辑（按优先级）：
#   1. daemon 已在跑 → 啥都不做
#   2. 状态文件不存在 → 启动
#   3. 跨日（quota 自动恢复）→ 启动
#   4. 今日 quota 未满（异常中断）→ 启动
#   5. 今日 quota 已满 → 等明天
#
# 启动方式：直接调 generate_voices.py（不走 voice_daemon.sh，
# 避免"启动后立即无任务退出"被误判为失败）
set -e

cd "$(dirname "$0")"
STATE_FILE=game/sounds/.generation_state.json
PID_FILE=logs/voice_daemon.pid

is_daemon_alive() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# 1) daemon 已在跑 → noop
if is_daemon_alive; then
    echo "[$(date '+%H:%M:%S')] daemon 已在跑 (PID $(cat "$PID_FILE"))，无需重启"
    exit 0
fi

# 2) 没状态文件 → 直接启动
if [ ! -f "$STATE_FILE" ]; then
    echo "[$(date '+%H:%M:%S')] 状态文件不存在，启动 daemon"
    setsid nohup bash -c "source /home/richardjl/shared/jianglei/claude/education_config.sh && python3 -u generate_voices.py --rate=1.5 --workers=1 --daily-quota=8000" \
        >> logs/voice_daemon.log 2>&1 &
    echo $! > "$PID_FILE"
    disown 2>/dev/null || true
    exit 0
fi

# 3-5) 解析状态决定是否启动
QUOTA=8000  # 留余量给 daily_quota
START=0
REASON=""

python3 - "$STATE_FILE" "$QUOTA" <<'PY' || START=0
import json, sys
from datetime import date
state_file, quota_str = sys.argv[1], sys.argv[2]
quota = int(quota_str)
s = json.loads(open(state_file).read())
today = str(date.today())
daily_date = s.get("daily_date", "")
daily_count = s.get("daily_count", 0)

if daily_date != today:
    print(f"[auto_restart] 日期已变 ({daily_date} → {today})，quota 恢复")
    sys.exit(0)  # START=0 (fall through to start)
if daily_count >= quota:
    print(f"[auto_restart] 今日 quota 已满 ({daily_count}/{quota})，等明天")
    sys.exit(1)  # 不启动
print(f"[auto_restart] 进程停了但 quota 未满 ({daily_count}/{quota})，重启")
sys.exit(0)  # 启动
PY

if [ $? -ne 0 ]; then
    exit 0  # quota 已满，啥都不做
fi

# 启动 daemon（必须传 --force：因为 state 可能显示全完成但磁盘文件是旧的）
echo "[$(date '+%H:%M:%S')] 启动 daemon (--force)..."
setsid nohup bash -c "source /home/richardjl/shared/jianglei/claude/education_config.sh && python3 -u generate_voices.py --force --rate=1.5 --workers=1 --daily-quota=8000" \
    >> logs/voice_daemon.log 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
disown 2>/dev/null || true

# 清理无效的 PID 文件（如果进程已经退出）
sleep 3
if ! kill -0 "$NEW_PID" 2>/dev/null; then
    # 进程已退出（可能因为没任务），不算错误
    rm -f "$PID_FILE"
    echo "[$(date '+%H:%M:%S')] 启动后进程立即退出（可能任务已全部完成），无需重启"
    exit 0
fi
echo "[$(date '+%H:%M:%S')] 已启动 (PID $NEW_PID)"
