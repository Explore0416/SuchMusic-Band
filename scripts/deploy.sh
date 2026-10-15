#!/usr/bin/env bash
#
# deploy.sh —— 侧载 .rpk 到小米手环 10
#
# 侧载方式（设计文档 §6.1）：
#   a) 「Notify for Xiaomi」App → 设备 → Third-party app → 上传 .rpk
#   b) 小米运动健康 App 开发者模式 / adb（若开放）
#
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RPK="${1:-}"
echo "== SuchMusic 手环端侧载 =="

if [ -z "$RPK" ]; then
  RPK="$(ls -1 dist/*.rpk 2>/dev/null | head -n1 || true)"
fi

if [ -z "$RPK" ] || [ ! -f "$RPK" ]; then
  echo "未找到 .rpk 产物。请先在本地用 AIoT-IDE 构建（sh scripts/build.sh），产物通常位于 dist/。" >&2
  echo "用法： sh scripts/deploy.sh [path/to/xxx.rpk]" >&2
  exit 1
fi

echo "rpk: $RPK"

if command -v adb >/dev/null 2>&1 && adb get-state >/dev/null 2>&1; then
  echo "---- 检测到 adb 设备，尝试安装 ----"
  adb install -r "$RPK" || echo "adb 安装失败：请改用 Notify for Xiaomi 上传（手环 10 通常不开放 adb 侧载）"
else
  echo "=============================================================="
  echo " 无可用 adb 设备。请用以下方式之一侧载（推荐 a）："
  echo "   a) Notify for Xiaomi → 设备 → Third-party app → 上传该 .rpk"
  echo "   b) 小米运动健康 开发者模式（若开放）"
  echo " 安装后：手环应用列表出现「SuchMusic」→ 打开 → 手机先放歌 → 首页显示当前播放"
  echo "=============================================================="
fi
