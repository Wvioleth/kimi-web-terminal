#!/bin/bash
# ============================================================
# Kimi Web Terminal 一键部署脚本
#
# 用法:
#   1. 交互式:   ./install.sh
#   2. 非交互式: KIMI_WEB_PASS=你的密码 ./install.sh
#
# 可用环境变量(全部可选):
#   INSTALL_DIR     安装目录           (默认 /opt/kimi-web)
#   PORT            监听端口           (默认 8015)
#   KIMI_WEB_USER   登录用户名         (默认 admin)
#   KIMI_WEB_PASS   登录密码           (默认随机生成并打印)
#   KIMI_BIN        Kimi CLI 路径      (默认自动探测 `which kimi`)
#   KIMI_WORK_DIR   Kimi 工作目录      (默认 /root 或当前用户家目录)
#   KIMI_ARGS       Kimi 启动参数      (默认 -y)
#   RUN_USER        运行服务的系统用户 (默认当前用户,root 运行时为 root)
# ============================================================
set -e

log()  { echo -e "\033[32m[+] $*\033[0m"; }
warn() { echo -e "\033[33m[!] $*\033[0m"; }
die()  { echo -e "\033[31m[x] $*\033[0m" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 定位项目根目录:发布包中本脚本在根目录,git 仓库中在 deploy/ 子目录
if [ -f "$SCRIPT_DIR/server.js" ]; then
  PROJECT_DIR="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../server.js" ]; then
  PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  echo "[x] 未找到 server.js,请确认本脚本位于项目根目录或 deploy/ 目录中" >&2
  exit 1
fi

# ---------- 0. 权限检查 ----------
if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
  die "需要 root 权限或 sudo,请用 root 运行: sudo ./install.sh"
fi
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# ---------- 1. 交互式配置 ----------
INSTALL_DIR="${INSTALL_DIR:-/opt/kimi-web}"
PORT="${PORT:-8015}"
KIMI_WEB_USER="${KIMI_WEB_USER:-admin}"
KIMI_ARGS="${KIMI_ARGS:--y}"
RUN_USER="${RUN_USER:-$(whoami)}"

# 自动探测 kimi 路径
if [ -z "$KIMI_BIN" ]; then
  KIMI_BIN="$(command -v kimi 2>/dev/null || true)"
  [ -z "$KIMI_BIN" ] && [ -x "$HOME/.kimi-code/bin/kimi" ] && KIMI_BIN="$HOME/.kimi-code/bin/kimi"
fi
KIMI_BIN="${KIMI_BIN:-/root/.kimi-code/bin/kimi}"

KIMI_WORK_DIR="${KIMI_WORK_DIR:-$(eval echo ~"$RUN_USER")}"

if [ -t 0 ]; then
  echo "====== Kimi Web Terminal 部署配置 (直接回车使用默认值) ======"
  read -rp "安装目录 [$INSTALL_DIR]: " v; INSTALL_DIR="${v:-$INSTALL_DIR}"
  read -rp "监听端口 [$PORT]: " v; PORT="${v:-$PORT}"
  read -rp "登录用户名 [$KIMI_WEB_USER]: " v; KIMI_WEB_USER="${v:-$KIMI_WEB_USER}"
  read -rp "登录密码 [随机生成]: " v; KIMI_WEB_PASS="${v:-$KIMI_WEB_PASS}"
  read -rp "Kimi CLI 路径 [$KIMI_BIN]: " v; KIMI_BIN="${v:-$KIMI_BIN}"
  read -rp "Kimi 工作目录 [$KIMI_WORK_DIR]: " v; KIMI_WORK_DIR="${v:-$KIMI_WORK_DIR}"
  read -rp "运行用户 [$RUN_USER]: " v; RUN_USER="${v:-$RUN_USER}"
fi

if [ -z "$KIMI_WEB_PASS" ]; then
  KIMI_WEB_PASS="$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  warn "未设置密码,已随机生成: $KIMI_WEB_PASS  (请妥善保存)"
fi

[ -x "$KIMI_BIN" ] || warn "Kimi CLI 不存在: $KIMI_BIN,请先安装 Kimi Code CLI,或之后修改 $INSTALL_DIR/.env 中的 KIMI_BIN"

# ---------- 2. 安装系统依赖 ----------
log "安装系统依赖 (node-pty 编译需要)..."
if command -v apt-get >/dev/null 2>&1; then
  $SUDO apt-get update -y
  $SUDO apt-get install -y curl python3 make g++ || $SUDO apt-get install -y curl python3 make gcc-c++
elif command -v dnf >/dev/null 2>&1; then
  $SUDO dnf install -y curl python3 make gcc-c++
elif command -v yum >/dev/null 2>&1; then
  $SUDO yum install -y curl python3 make gcc-c++
else
  warn "未识别的包管理器,请确认已安装: curl python3 make g++"
fi

# ---------- 3. 安装 Node.js ----------
if ! command -v node >/dev/null 2>&1; then
  log "未检测到 Node.js,通过 NodeSource 安装 Node 20 LTS..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
    $SUDO apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO -E bash -
    $SUDO "$(command -v dnf || command -v yum)" install -y nodejs
  else
    die "无法自动安装 Node.js,请手动安装 Node.js >= 18 后重试"
  fi
fi
log "Node.js: $(node -v), npm: $(npm -v)"

NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 版本过低 ($(node -v)),需要 >= 18"

# ---------- 4. 安装项目 ----------
log "安装到 $INSTALL_DIR ..."
$SUDO mkdir -p "$INSTALL_DIR"
$SUDO cp "$PROJECT_DIR"/server.js "$PROJECT_DIR"/package.json "$PROJECT_DIR"/package-lock.json \
  "$PROJECT_DIR"/README.md "$PROJECT_DIR"/start.sh "$INSTALL_DIR"/
[ -f "$PROJECT_DIR/ecosystem.config.example.js" ] && $SUDO cp "$PROJECT_DIR/ecosystem.config.example.js" "$INSTALL_DIR"/
[ -d "$PROJECT_DIR/public" ] && $SUDO cp -r "$PROJECT_DIR/public" "$INSTALL_DIR"/
[ -d "$PROJECT_DIR/deploy" ] && $SUDO cp -r "$PROJECT_DIR/deploy" "$INSTALL_DIR"/
$SUDO mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/logs"

cd "$INSTALL_DIR"
log "安装 Node 依赖 (node-pty 首次安装可能需要编译,请耐心等待)..."
if [ -f package-lock.json ]; then
  $SUDO npm ci --omit=dev || $SUDO npm install --omit=dev
else
  $SUDO npm install --omit=dev
fi

# ---------- 5. 生成配置 ----------
KIMI_WS_TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
$SUDO tee "$INSTALL_DIR/.env" >/dev/null <<EOF
PORT=$PORT
KIMI_WEB_USER=$KIMI_WEB_USER
KIMI_WEB_PASS=$KIMI_WEB_PASS
KIMI_WS_TOKEN=$KIMI_WS_TOKEN
KIMI_BIN=$KIMI_BIN
KIMI_ARGS=$KIMI_ARGS
KIMI_WORK_DIR=$KIMI_WORK_DIR
EOF
$SUDO chmod 600 "$INSTALL_DIR/.env"
$SUDO chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR" 2>/dev/null || true

# ---------- 6. 注册服务 ----------
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  log "注册 systemd 服务 kimi-web ..."
  $SUDO tee /etc/systemd/system/kimi-web.service >/dev/null <<EOF
[Unit]
Description=Kimi Web Terminal
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3
StandardOutput=append:$INSTALL_DIR/logs/out.log
StandardError=append:$INSTALL_DIR/logs/err.log

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now kimi-web
  STARTED_BY="systemd"
elif command -v pm2 >/dev/null 2>&1; then
  log "使用 pm2 启动 ..."
  cd "$INSTALL_DIR"
  set -a; . ./.env; set +a
  $SUDO -E env PORT="$PORT" KIMI_WEB_USER="$KIMI_WEB_USER" KIMI_WEB_PASS="$KIMI_WEB_PASS" \
    KIMI_WS_TOKEN="$KIMI_WS_TOKEN" KIMI_BIN="$KIMI_BIN" KIMI_ARGS="$KIMI_ARGS" \
    KIMI_WORK_DIR="$KIMI_WORK_DIR" pm2 start server.js --name kimi-web
  $SUDO pm2 save
  STARTED_BY="pm2"
else
  warn "未检测到 systemd 或 pm2,仅完成安装。请手动启动:"
  warn "  cd $INSTALL_DIR && set -a && . ./.env && set +a && node server.js"
  STARTED_BY="manual"
fi

# ---------- 7. 完成 ----------
echo
echo "============================================================"
log "部署完成!"
echo "  访问地址:   http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '服务器IP'):$PORT"
echo "  登录用户名: $KIMI_WEB_USER"
echo "  登录密码:   $KIMI_WEB_PASS"
echo "  配置文件:   $INSTALL_DIR/.env  (修改后需重启服务)"
[ "$STARTED_BY" = "systemd" ] && echo "  服务管理:   systemctl status|restart|stop kimi-web"
[ "$STARTED_BY" = "pm2" ] && echo "  服务管理:   pm2 status / pm2 restart kimi-web"
echo "============================================================"
warn "安全提示: 请勿直接暴露到公网;如需公网访问请前置 HTTPS 反向代理。"
