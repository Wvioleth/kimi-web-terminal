# Kimi Web Terminal

通过 WebSocket 把 Kimi Code CLI 的 PTY 桥接到浏览器。每个任务对应一个独立的 Kimi CLI 会话：关闭网页或服务器重启后，仍可连回并恢复 Kimi 自己的会话上下文继续操作。

## ⚠️ 安全警告

此工具把 Kimi CLI 的完整执行能力暴露到 Web。任何通过认证的人都相当于拥有服务器上运行 Kimi 的用户的权限，可以读写文件、执行命令等。

**请务必：**
- 设置强密码 (`KIMI_WEB_PASS`)
- 不要直接暴露在公网，除非前置了 HTTPS + 强认证
- 考虑仅监听内网或本机，并通过 VPN/SSH 隧道访问
- 运行 Kimi CLI 的用户权限应尽量小

## 功能

- **登录后任务列表**：左侧边栏显示所有正在运行或已结束的任务
- **新建任务**：点击“新建任务”启动独立的 Kimi CLI 会话
- **删除任务**：结束并移除指定会话
- **重命名任务**：自定义任务名称，方便区分
- **关闭网页不中断**：WebSocket 断开后，Kimi PTY 进程继续运行
- **重新连回并恢复上下文**：刷新页面、重新登录或服务器重启后，如果任务对应的 Kimi CLI session 仍然存在，点击任务会恢复该 session 继续之前的对话

## 一键部署到新服务器

### 方式 A:从 GitHub Release 下载(推荐)

```bash
wget https://github.com/Wvioleth/kimi-web-terminal/releases/download/v1.0.2/kimi-web-1.0.2.tar.gz
tar -xzf kimi-web-1.0.2.tar.gz && cd kimi-web
sudo ./install.sh
```

### 方式 B:克隆仓库

```bash
git clone https://github.com/Wvioleth/kimi-web-terminal.git
cd kimi-web-terminal
sudo deploy/install.sh   # 注意:克隆方式下脚本在 deploy/ 目录
```

脚本会自动完成:安装系统依赖( gcc / make / python3,node-pty 编译需要)→ 安装 Node.js(如缺失)→ `npm ci` 安装依赖 → 交互式配置端口/账号/密码/Kimi CLI 路径/工作目录 → 注册 systemd 服务(无 systemd 时回退 pm2)并启动。

非交互式部署(全部走环境变量):

```bash
sudo KIMI_WEB_PASS=你的强密码 PORT=8015 KIMI_WORK_DIR=/data ./install.sh
```

前置要求:目标服务器已安装 Kimi Code CLI 并完成登录授权(脚本会自动探测 `kimi` 路径)。

修改配置:编辑 `/opt/kimi-web/.env`,然后 `systemctl restart kimi-web`。

卸载:`systemctl disable --now kimi-web && rm -rf /opt/kimi-web /etc/systemd/system/kimi-web.service`。

## 启动(开发/手动方式)

```bash
cd /www/web/other/kimi-web

# 方式1：直接启动（会生成随机密码并打印在控制台）
node server.js

# 方式2：设置密码后启动
export KIMI_WEB_USER=admin
export KIMI_WEB_PASS=你的强密码
node server.js

# 方式3：使用脚本
./start.sh
```

默认端口：`8015`

访问：`http://服务器IP:8015`

## 配置

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 监听端口 | `8015` |
| `KIMI_WEB_USER` | 登录用户名 | `admin` |
| `KIMI_WEB_PASS` | 登录密码 | 随机生成并打印 |
| `KIMI_BIN` | Kimi CLI 路径 | `/root/.kimi-code/bin/kimi` |
| `KIMI_ARGS` | Kimi CLI 启动参数 | `-y` |
| `KIMI_WORK_DIR` | Kimi 启动时的工作目录 | `/www/web` |
| `BUFFER_MAX_SIZE` | 单个任务输出缓冲区最大字节数 | `1048576` (1MB) |
| `KIMI_WS_TOKEN` | WebSocket/API 固定 Token | 随机生成 |

## 使用 pm2 常驻运行

```bash
cd /www/web/other/kimi-web
# 方式1:直接启动
pm2 start server.js --name kimi-web
# 方式2:使用配置文件(先复制示例并修改密码)
cp ecosystem.config.example.js ecosystem.config.js
pm2 start ecosystem.config.js
pm2 save
```

## 后端 API

所有 API 均需在请求头携带 `Authorization: Bearer <token>`，token 即登录接口返回的 `token`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | 登录，返回 token |
| GET | `/api/tasks` | 获取任务列表 |
| POST | `/api/tasks` | 新建任务，`{ name? }` |
| POST | `/api/tasks/:id/write` | 向任务 PTY 写入命令，`{ command }` |
| GET | `/api/tasks/:id/buffer` | 获取任务当前输出缓冲区（UTF-8 文本） |
| DELETE | `/api/tasks/:id` | 删除任务 |
| POST | `/api/tasks/:id/rename` | 重命名任务，`{ name }` |
| GET | `/api/tasks/:id/export` | 导出任务记录为 JSON |
| GET | `/api/tasks/:id/export.txt` | 导出任务记录为纯文本 |

## WebSocket

连接路径：`/ws?token=<token>&sessionId=<sessionId>`

- 先连接指定任务的历史输出缓冲区
- 之后实时双向转发 PTY 数据
- 终端大小调整沿用转义序列 `ESC[8;rows;cols;t`
- WebSocket 断开后，对应 PTY 进程继续运行

## 实现原理

1. 后端用 `node-pty` 启动 Kimi CLI
2. 每个任务对应一个独立的 PTY 进程，由 `SessionManager` 统一管理
3. PTY 输出写入滚动缓冲区，并转发给当前 attach 的 WebSocket
4. 前端用 `xterm.js` 渲染终端；点击任务时通过 `sessionId` attach 到已有 PTY

## 限制

- 任务历史已持久化到 `data/sessions.json`，**服务器重启后可恢复历史输出**；只有当对应 Kimi CLI session 仍存在时，才能继续交互
- 任务 PTY 进程结束后，再次打开该任务不会自动新建会话，仅可查看历史；如需新会话请创建新任务
- 当前按单用户工具设计，所有登录用户共享同一套任务列表
- 输出缓冲区有上限（默认 1MB/任务），超过后会丢弃最旧的输出
