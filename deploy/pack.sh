#!/bin/bash
# 打包 kimi-web 为可发布 tar.gz(输出到 dist/)
set -e
cd "$(dirname "$0")/.."

VER=$(node -p "require('./package.json').version")
STAGE=$(mktemp -d)/kimi-web
mkdir -p "$STAGE"

cp server.js package.json package-lock.json README.md start.sh ecosystem.config.example.js "$STAGE"/
cp -r public "$STAGE"/
cp deploy/install.sh "$STAGE"/install.sh
chmod +x "$STAGE"/install.sh "$STAGE"/start.sh

mkdir -p dist
tar -czf "dist/kimi-web-${VER}.tar.gz" -C "$(dirname "$STAGE")" kimi-web
rm -rf "$(dirname "$STAGE")"

echo "已生成: dist/kimi-web-${VER}.tar.gz"
