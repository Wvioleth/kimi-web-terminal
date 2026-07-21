#!/bin/bash
# Kimi Web Terminal 启动脚本
# 建议先设置密码: export KIMI_WEB_PASS=你的强密码
# 可选: export KIMI_WEB_USER=admin
# 可选: export KIMI_BIN=/root/.kimi-code/bin/kimi
# 可选: export KIMI_WORK_DIR=/www/web

cd "$(dirname "$0")"
exec node server.js
