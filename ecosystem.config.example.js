// pm2 配置示例。复制为 ecosystem.config.js 并修改密码后使用:
//   cp ecosystem.config.example.js ecosystem.config.js
//   pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'kimi-web',
    script: './server.js',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 8015,
      KIMI_WEB_USER: 'admin',
      // 生产环境请务必修改默认密码
      KIMI_WEB_PASS: 'change-me-to-a-strong-password',
      KIMI_ARGS: '-y',
      // 固定 WebSocket/API token,避免 pm2 重启后已登录客户端失效;请改为随机值
      KIMI_WS_TOKEN: 'change-me-to-a-random-token'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    combine_logs: true
  }]
};
