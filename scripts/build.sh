#!/usr/bin/env bash
#
# build.sh —— 构建 .rpk
#
# ⚠️ 事实（设计文档 §6.1）：.rpk 依赖**小米 AIoT-IDE（专有工具链）**，
#    本沙箱/服务器环境**无法**构建。本脚本在检测到 CLI 时调用 CLI，
#    否则打印用户本地需执行的完整步骤并退出。
#
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "== SuchMusic 手环端构建 =="

# 1) 前置校验：manifest 包名 / designWidth
echo "---- 校验 manifest ----"
python3 - <<'PY'
import json,sys
m=json.load(open('src/manifest.json'))
assert m['package']=='com.lightningteam.suchmusic', 'package 必须为 com.lightningteam.suchmusic'
assert m['config']['designWidth']==106, 'designWidth 必须为 106'
assert 'watch' in m['deviceTypeList'], 'deviceTypeList 必须含 watch'
feats=[f.get('name') for f in m.get('features',[])]
for need in ['system.interconnect','system.storage','system.router','system.file']:
    assert need in feats, 'features 缺少 '+need
print('manifest OK: package=%s designWidth=%s deviceTypeList=%s'%(m['package'],m['config']['designWidth'],m['deviceTypeList']))
PY

# 2) 签名检查（PEM 必须存在，且不提交）
if [ ! -f sign/sign.pem ]; then
  echo "!! 未找到 sign/sign.pem —— 请先执行： sh scripts/export_cert.sh" >&2
  echo "   （PEM 含私钥，不进仓库，仅本地生成）" >&2
fi

# 3) 尝试调用 AIoT-IDE CLI
if command -v quickapp >/dev/null 2>&1; then
  echo "---- 调用 quickapp CLI 打包 ----"
  quickapp build --release
elif command -v aiot-ide >/dev/null 2>&1; then
  echo "---- 调用 aiot-ide CLI 打包 ----"
  aiot-ide build --release
else
  echo "=============================================================="
  echo " 未检测到小米 AIoT-IDE CLI（专有工具链）。请在**本地**执行："
  echo "   1) 安装 Node.js 18.x 与 小米 AIoT-IDE"
  echo "   2) sh scripts/export_cert.sh   # 生成 sign/sign.pem"
  echo "   3) AIoT-IDE 打开本工程，Signing 指向 sign/sign.pem（口令见 key.properties）"
  echo "   4) Build → Release(.rpk)"
  echo "   产物示例： dist/com.lightningteam.suchmusic.debug.1.0.0.rpk"
  echo "   5) 侧载：见 sh scripts/deploy.sh"
  echo "=============================================================="
fi
