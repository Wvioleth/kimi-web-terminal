const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 8015;
const KIMI_BIN = process.env.KIMI_BIN || '/root/.kimi-code/bin/kimi';
// Kimi CLI 启动参数，默认 -y（yolo 自动确认所有操作）
// 如需关闭 yolo 模式可设为空字符串或自定义参数，例如 '--auto' 或 ''
const KIMI_ARGS = process.env.KIMI_ARGS ? process.env.KIMI_ARGS.split(/\s+/).filter(Boolean) : ['-y'];
const WORK_DIR = process.env.KIMI_WORK_DIR || path.resolve(__dirname, '../..');

function parseIntEnv(value, defaultValue) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

const BUFFER_MAX_SIZE = parseIntEnv(process.env.BUFFER_MAX_SIZE, 1048576); // 1MB
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SAVE_INTERVAL_MS = parseIntEnv(process.env.SAVE_INTERVAL_MS, 30000); // 默认 30 秒

// 把命令末尾统一为 \r，保证交互式 PTY 能正确触发输入处理
function normalizeCommandEnding(command) {
  if (typeof command !== 'string') return command;
  if (command.endsWith('\r\n')) {
    return command.slice(0, -1); // 保留 \r
  }
  if (command.endsWith('\n')) {
    return command.slice(0, -1) + '\r';
  }
  if (!command.endsWith('\r')) {
    return command + '\r';
  }
  return command;
}

// Kimi CLI 会话索引路径
const KIMI_SESSION_INDEX = path.join(os.homedir(), '.kimi-code', 'session_index.jsonl');

// 用于防止多个任务同时创建 Kimi 进程时 session 检测冲突
class Mutex {
  constructor() {
    this._promise = Promise.resolve();
  }
  acquire() {
    let release;
    const p = new Promise(resolve => { release = resolve; });
    const wait = this._promise;
    this._promise = wait.then(() => p);
    return wait.then(() => release);
  }
}
const spawnMutex = new Mutex();

function readSessionCreatedAt(sessionDir) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(sessionDir, 'state.json'), 'utf8'));
    return state.createdAt || null;
  } catch (e) {
    return null;
  }
}

function readSessionIndex() {
  if (!fs.existsSync(KIMI_SESSION_INDEX)) return [];
  try {
    return fs.readFileSync(KIMI_SESSION_INDEX, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch (e) { return null; }
      })
      .filter(Boolean);
  } catch (e) { return []; }
}

function getKimiSessionIdsForWorkDir(workDir) {
  const ids = new Set();
  for (const entry of readSessionIndex()) {
    if (entry.workDir === workDir && entry.sessionId) ids.add(entry.sessionId);
  }
  return ids;
}

function getKimiSessionDir(sessionId) {
  for (const entry of readSessionIndex()) {
    if (entry.sessionId === sessionId) return entry.sessionDir || null;
  }
  return null;
}

function isKimiSessionValid(sessionId) {
  const sessionDir = getKimiSessionDir(sessionId);
  if (!sessionDir) return false;
  return fs.existsSync(sessionDir) && fs.existsSync(path.join(sessionDir, 'state.json'));
}

function findNewKimiSession(workDir, beforeIds, spawnTime) {
  if (!fs.existsSync(KIMI_SESSION_INDEX)) return null;
  const candidates = [];
  try {
    const lines = fs.readFileSync(KIMI_SESSION_INDEX, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.workDir === workDir && entry.sessionId && !beforeIds.has(entry.sessionId)) {
          const createdAt = readSessionCreatedAt(entry.sessionDir);
          if (createdAt) {
            candidates.push({ sessionId: entry.sessionId, createdAt: new Date(createdAt) });
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  if (candidates.length === 0) return null;
  // 选择 createdAt 与 spawnTime 最接近的会话
  candidates.sort((a, b) => Math.abs(a.createdAt - spawnTime) - Math.abs(b.createdAt - spawnTime));
  return candidates[0].sessionId;
}

// 认证配置
const AUTH_USER = process.env.KIMI_WEB_USER || 'admin';
let AUTH_PASS = process.env.KIMI_WEB_PASS;
if (!AUTH_PASS) {
  AUTH_PASS = crypto.randomBytes(8).toString('hex');
  console.log(`[WARN] KIMI_WEB_PASS 未设置，已生成随机密码: ${AUTH_PASS}`);
}

// WebSocket 连接 Token
const WS_TOKEN = process.env.KIMI_WS_TOKEN || crypto.randomBytes(16).toString('hex');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 滚动字节缓冲区，用于保留 PTY 最近输出
 */
class RollingBuffer {
  constructor(maxSize, chunks = []) {
    this.maxSize = maxSize;
    this.chunks = chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c, 'base64'));
    this.totalSize = this.chunks.reduce((sum, c) => sum + c.length, 0);
    this._trim();
  }

  push(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
    this.chunks.push(buf);
    this.totalSize += buf.length;
    this._trim();
  }

  _trim() {
    while (this.totalSize > this.maxSize && this.chunks.length > 0) {
      if (this.chunks.length === 1) {
        // 只剩下一个 chunk 且它本身就超过上限时，截断保留最新部分
        const chunk = this.chunks[0];
        const keep = this.maxSize;
        if (keep > 0 && chunk.length > keep) {
          this.chunks[0] = chunk.slice(chunk.length - keep);
          this.totalSize = this.chunks[0].length;
        } else {
          this.chunks.shift();
          this.totalSize = 0;
        }
        break;
      }
      const removed = this.chunks.shift();
      this.totalSize -= removed.length;
    }
    if (this.totalSize < 0) this.totalSize = 0;
  }

  toBuffer() {
    if (this.chunks.length === 0) return Buffer.alloc(0);
    if (this.chunks.length === 1) return this.chunks[0];
    return Buffer.concat(this.chunks);
  }

  toBase64() {
    return this.toBuffer().toString('base64');
  }
}

/**
 * 单个任务会话，对应一个 PTY 进程
 */
class Session {
  constructor(options = {}) {
    // 恢复模式：传入序列化数据
    if (options.id) {
      this.id = options.id;
      this.name = options.name || `任务 ${this.id.slice(0, 6)}`;
      this.createdAt = options.createdAt || new Date().toISOString();
      this.status = options.status || 'exited';
      this.exitCode = options.exitCode ?? null;
      this.pid = options.pid ?? null;
      this.kimiSessionId = options.kimiSessionId || null;
      this.buffer = new RollingBuffer(BUFFER_MAX_SIZE, options.bufferChunks || []);
      this.lastActivity = Date.now();
      this.ptyProcess = null;
      this.ws = null;
      this._kimiSessionDetection = Promise.resolve();
      return;
    }

    // 新建模式
    this.id = crypto.randomBytes(8).toString('hex');
    this.name = options.name || `任务 ${this.id.slice(0, 6)}`;
    this.createdAt = new Date().toISOString();
    this.status = 'running';
    this.exitCode = null;
    this.ws = null;
    this.buffer = new RollingBuffer(BUFFER_MAX_SIZE);
    this.lastActivity = Date.now();
    this.kimiSessionId = null;

    this._spawnPty();
    this._kimiSessionDetection = this._detectKimiSession();
  }

  _spawnPty(resumeSessionId = null) {
    const args = resumeSessionId ? ['-S', resumeSessionId, ...KIMI_ARGS] : KIMI_ARGS;
    this.ptyProcess = pty.spawn(KIMI_BIN, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: WORK_DIR,
      env: process.env
    });

    this.pid = this.ptyProcess.pid;
    this.status = 'running';
    this.exitCode = null;
    this._bindPtyEvents();
  }

  async _detectKimiSession() {
    const spawnTime = new Date(this.createdAt);
    const release = await spawnMutex.acquire();
    try {
      const beforeIds = getKimiSessionIdsForWorkDir(WORK_DIR);
      let sid = null;
      // 轮询等待 Kimi 把新会话写入索引，最多 5 秒
      for (let i = 0; i < 25; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        sid = findNewKimiSession(WORK_DIR, beforeIds, spawnTime);
        if (sid) break;
      }
      if (sid) {
        this.kimiSessionId = sid;
        console.log(`[Session ${this.id}] 检测到 Kimi session: ${sid}`);
      } else {
        console.log(`[Session ${this.id}] 未检测到 Kimi session`);
      }
    } catch (err) {
      console.error(`[Session ${this.id}] 检测 Kimi session 失败:`, err);
    } finally {
      release();
    }
  }

  _bindPtyEvents() {
    this.ptyProcess.onData((data) => {
      this.buffer.push(data);
      this.lastActivity = Date.now();
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(data);
        } catch (err) {
          console.error(`[Session ${this.id}] WebSocket 发送失败:`, err);
        }
      }
      this._scheduleSave();
    });

    this.ptyProcess.on('error', (err) => {
      console.error(`[Session ${this.id}] PTY 进程错误:`, err);
      this._handlePtyError(err);
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      // 如果已经被 _handlePtyError 标记为结束，避免重复推送结束消息
      if (this.status !== 'exited') {
        this.status = 'exited';
        this.exitCode = exitCode;
        const exitMsg = `\r\n\x1b[31m[任务已结束，exitCode=${exitCode}]\x1b[0m\r\n`;
        this.buffer.push(exitMsg);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          try { this.ws.send(exitMsg); } catch (e) {}
        }
      } else {
        this.exitCode = exitCode;
      }
      this._scheduleSave();
    });
  }

  async respawn(options = { allowFreshStart: false }) {
    if (this.isAlive()) return true;

    const allowFreshStart = options && options.allowFreshStart;

    // 优先恢复 Kimi CLI 自己的 session；只有在明确允许且没有可恢复 session 时才新建
    let resumeId = this.kimiSessionId;
    if (resumeId && !isKimiSessionValid(resumeId)) {
      console.log(`[Session ${this.id}] 原 Kimi session ${resumeId} 已不可用`);
      resumeId = null;
    }

    if (!resumeId && !allowFreshStart) {
      console.log(`[Session ${this.id}] 没有可恢复的 Kimi session，且不允许新建，保持只读`);
      return false;
    }

    console.log(`[Session ${this.id}] PTY 已结束，尝试${resumeId ? '恢复 Kimi session' : '重新启动'}...`);
    if (this.ptyProcess) {
      try {
        this.ptyProcess.removeAllListeners();
        this.ptyProcess.kill();
      } catch (e) {}
      this.ptyProcess = null;
    }

    // 等待 Kimi session 检测完成
    if (this._kimiSessionDetection) {
      try { await this._kimiSessionDetection; } catch (e) {}
    }

    // 再次校验，检测完成后可能仍未找到 session
    if (resumeId && !isKimiSessionValid(resumeId)) {
      console.log(`[Session ${this.id}] 原 Kimi session ${resumeId} 已不可用`);
      resumeId = null;
    }
    if (!resumeId && !allowFreshStart) {
      console.log(`[Session ${this.id}] 没有可恢复的 Kimi session，且不允许新建，保持只读`);
      return false;
    }

    try {
      this._spawnPty(resumeId);
    } catch (err) {
      console.error(`[Session ${this.id}] 重新启动 PTY 失败:`, err);
      this.status = 'exited';
      return false;
    }
    const restartMsg = resumeId
      ? '\r\n\x1b[33m[任务已恢复，继续之前的 Kimi session]\x1b[0m\r\n'
      : '\r\n\x1b[33m[任务已重新启动，可继续交互]\x1b[0m\r\n';
    this.buffer.push(restartMsg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(restartMsg); } catch (e) {}
    }
    this._scheduleSave();
    console.log(`[Session ${this.id}] PTY 重新启动成功 (pid=${this.pid}, resume=${!!resumeId})`);
    return true;
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (sessionManager) sessionManager.save();
    }, 500);
  }

  isAlive() {
    return this.status === 'running' && this.ptyProcess !== null;
  }

  attach(ws) {
    this.detach();
    this.ws = ws;
    // 先推送历史输出
    const history = this.buffer.toBuffer();
    if (history.length > 0) {
      try {
        ws.send(history);
      } catch (err) {
        console.error(`[Session ${this.id}] 发送历史输出失败:`, err);
      }
    }
  }

  detach(ws = this.ws) {
    // 只有当前 attach 的 ws 才能清空，防止旧连接的 close 事件把新连接 detach
    if (this.ws && this.ws === ws) {
      this.ws = null;
    }
  }

  _handlePtyError(err) {
    if (this.status === 'exited') return;
    console.error(`[Session ${this.id}] PTY 异常，标记任务结束:`, err && err.message);
    this.status = 'exited';
    const exitMsg = '\r\n\x1b[31m[任务已结束（PTY 异常）]\x1b[0m\r\n';
    this.buffer.push(exitMsg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(exitMsg); } catch (e) {}
    }
    this.detach();
    this._scheduleSave();
    try {
      if (this.ptyProcess) this.ptyProcess.kill();
    } catch (e) {}
  }

  async write(data) {
    if (!this.isAlive()) {
      const ok = await this.respawn();
      if (!ok) return false;
    }
    try {
      this.ptyProcess.write(data);
      this.lastActivity = Date.now();
      return true;
    } catch (err) {
      this._handlePtyError(err);
      return false;
    }
  }

  resize(cols, rows) {
    if (this.status === 'running' && this.ptyProcess) {
      try {
        this.ptyProcess.resize(cols, rows);
      } catch (err) {
        console.error(`[Session ${this.id}] resize 失败:`, err);
      }
    }
  }

  kill() {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch (err) {
        console.error(`[Session ${this.id}] kill 失败:`, err);
      }
    }
    this.status = 'exited';
    this.detach();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      pid: this.pid,
      createdAt: this.createdAt,
      exitCode: this.exitCode,
      kimiSessionId: this.kimiSessionId
    };
  }

  serialize() {
    return {
      ...this.toJSON(),
      bufferBase64: this.buffer.toBase64()
    };
  }

  static deserialize(data) {
    return new Session({
      id: data.id,
      name: data.name,
      status: data.status,
      createdAt: data.createdAt,
      exitCode: data.exitCode,
      pid: data.pid,
      kimiSessionId: data.kimiSessionId,
      bufferChunks: data.bufferBase64 ? [Buffer.from(data.bufferBase64, 'base64')] : []
    });
  }
}

/**
 * 会话管理器
 */
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this._saveTimer = null;
  }

  create(options = {}) {
    const session = new Session(options);
    this.sessions.set(session.id, session);
    console.log(`[SessionManager] 创建任务 ${session.id} (pid=${session.pid})`);
    this.save();
    return session;
  }

  list() {
    return Array.from(this.sessions.values()).map(s => s.toJSON());
  }

  get(id) {
    return this.sessions.get(id);
  }

  kill(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.kill();
    this.sessions.delete(id);
    console.log(`[SessionManager] 删除任务 ${id}`);
    this.save();
    return true;
  }

  rename(id, name) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.name = String(name || session.name).slice(0, 100);
    this.save();
    return true;
  }

  save() {
    try {
      const data = {
        savedAt: new Date().toISOString(),
        sessions: Array.from(this.sessions.values()).map(s => s.serialize())
      };
      const tmpFile = SESSIONS_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      fs.renameSync(tmpFile, SESSIONS_FILE);
    } catch (err) {
      console.error('[SessionManager] 保存会话失败:', err);
    }
  }

  load() {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    try {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (!data.sessions || !Array.isArray(data.sessions)) return;

      for (const item of data.sessions) {
        const session = Session.deserialize(item);
        // 已恢复的会话无法保留 PTY 进程，只能查看历史
        if (session.status === 'running') {
          session.status = 'exited';
          session.exitCode = session.exitCode ?? null;
          if (!session.kimiSessionId || !isKimiSessionValid(session.kimiSessionId)) {
            const msg = '\r\n\x1b[33m[服务重启，该任务的历史记录已恢复，但无法继续交互]\x1b[0m\r\n';
            session.buffer.push(msg);
            session._scheduleSave();
          }
        }
        this.sessions.set(session.id, session);
        console.log(`[SessionManager] 恢复任务 ${session.id} (${session.name})`);
      }
      console.log(`[SessionManager] 已恢复 ${this.sessions.size} 个任务`);
    } catch (err) {
      console.error('[SessionManager] 加载会话失败:', err);
    }
  }
}

const sessionManager = new SessionManager();

const app = express();
app.use(express.json());

// 登录接口
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === AUTH_USER && password === AUTH_PASS) {
    return res.json({ token: WS_TOKEN, username: AUTH_USER });
  }
  return res.status(401).json({ error: '用户名或密码错误' });
});

// Token 校验中间件
function requireToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token !== WS_TOKEN) {
    return res.status(401).json({ error: '未授权' });
  }
  next();
}

// 任务 API
app.get('/api/tasks', requireToken, (req, res) => {
  res.json(sessionManager.list());
});

app.post('/api/tasks', requireToken, (req, res) => {
  const { name } = req.body || {};
  try {
    const session = sessionManager.create({ name });
    res.json(session.toJSON());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/tasks/:id/write', requireToken, async (req, res) => {
  const session = sessionManager.get(req.params.id);
  if (!session) return res.status(404).json({ error: '任务不存在' });
  const { command } = req.body || {};
  if (typeof command !== 'string') return res.status(400).json({ error: '缺少 command 字段' });
  const data = normalizeCommandEnding(command);
  const ok = await session.write(data);
  if (!ok) return res.status(500).json({ error: '任务无法重新启动或写入失败' });
  res.json({ ok: true });
});

app.get('/api/tasks/:id/buffer', requireToken, (req, res) => {
  const session = sessionManager.get(req.params.id);
  if (!session) return res.status(404).json({ error: '任务不存在' });
  const text = session.buffer.toBuffer().toString('utf8');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(text);
});

app.delete('/api/tasks/:id', requireToken, (req, res) => {
  const ok = sessionManager.kill(req.params.id);
  if (!ok) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true });
});

app.post('/api/tasks/:id/rename', requireToken, (req, res) => {
  const { name } = req.body || {};
  const ok = sessionManager.rename(req.params.id, name);
  if (!ok) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true });
});

// 导出单个会话记录为 JSON
app.get('/api/tasks/:id/export', requireToken, (req, res) => {
  const session = sessionManager.get(req.params.id);
  if (!session) return res.status(404).json({ error: '任务不存在' });
  const filename = `kimi-task-${session.id}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(session.serialize());
});

// 导出单个会话记录为纯文本
app.get('/api/tasks/:id/export.txt', requireToken, (req, res) => {
  const session = sessionManager.get(req.params.id);
  if (!session) return res.status(404).json({ error: '任务不存在' });
  const filename = `kimi-task-${session.id}.txt`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const text = session.buffer.toBuffer().toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  res.send(text);
});

// 静态资源
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token');
  const sessionId = url.searchParams.get('sessionId');

  if (token !== WS_TOKEN) {
    console.log('[WS] token 验证失败，断开连接');
    ws.close(1008, 'Invalid token');
    return;
  }

  if (!sessionId) {
    console.log('[WS] 缺少 sessionId，断开连接');
    ws.close(1008, 'Missing sessionId');
    return;
  }

  const session = sessionManager.get(sessionId);
  if (!session) {
    console.log(`[WS] 任务 ${sessionId} 不存在，断开连接`);
    ws.close(1008, 'Session not found');
    return;
  }

  // 如果任务已结束，尝试重新启动 PTY，并尽量恢复 Kimi 自己的 session 上下文
  if (!session.isAlive()) {
    const resumed = await session.respawn();
    if (!resumed) {
      console.log(`[WS] 任务 ${sessionId} 无法重新启动，仅允许查看历史`);
      session.attach(ws);
      ws.on('close', () => session.detach(ws));
      ws.on('error', (err) => {
        console.error(`[WS] 任务 ${sessionId} 错误:`, err);
        session.detach(ws);
      });
      return;
    }
  }

  console.log(`[WS] 客户端已连接到任务 ${sessionId}`);
  session.attach(ws);

  ws.on('message', async (message) => {
    const data = message.toString();
    if (data.startsWith('\x1b[8;')) {
      // 终端大小调整: ESC[8;rows;cols;t
      const match = data.match(/\x1b\[8;(\d+);(\d+)t/);
      if (match) {
        const rows = parseInt(match[1], 10);
        const cols = parseInt(match[2], 10);
        session.resize(cols, rows);
      }
      return;
    }
    await session.write(data);
  });

  ws.on('close', () => {
    console.log(`[WS] 客户端已断开任务 ${sessionId}`);
    session.detach(ws);
  });

  ws.on('error', (err) => {
    console.error(`[WS] 任务 ${sessionId} 错误:`, err);
    session.detach(ws);
  });
});

// 启动时加载历史会话
sessionManager.load();

// 定期保存
setInterval(() => sessionManager.save(), SAVE_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`Kimi Web Terminal 运行在 http://0.0.0.0:${PORT}`);
  console.log(`工作目录: ${WORK_DIR}`);
  console.log(`用户名: ${AUTH_USER}`);
});
