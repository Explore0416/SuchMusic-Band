#!/usr/bin/env bash
#
# build.sh —— 构建手环 .rpk（官方 aiot 工具链）
#
# 关键事实（已用官方 Vela 模拟器实测确认）：
#   手环运行的是 **aiot 字节码（.jsc）**，由官方 aiot-toolkit 产出；
#   手机的 hap-toolkit 只产 **.js**，手环运行时不认 → 应用会卡在启动页。
#   因此这里必须用 aiot，并显式开 --enable-jsc。
#
# 签名：手环快应用必须与手机 App「包名 + 签名完全一致」，否则 system.interconnect
#       会静默拒绝通信。sign/certificate.pem + sign/private.pem 由
#       scripts/export_cert.sh 从手机 keystore 导出；存在时用 `aiot release`
#       出正式签名包，否则回退 `aiot build`（调试签名）。
#
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "== SuchMusic 手环端构建（aiot 工具链）=="

# 1) 前置校验：manifest 包名 / designWidth / router 规范
echo "---- 校验 manifest ----"
python3 - <<'PY'
import json,sys
m=json.load(open('src/manifest.json'))
assert m['package']=='com.lightningteam.suchmusic', 'package 必须为 com.lightningteam.suchmusic'
assert m['config']['designWidth']==212, 'designWidth 必须为 212（小米手环 10 设计宽度）'
assert 'watch' in m['deviceTypeList'], 'deviceTypeList 必须含 watch'
feats=[f.get('name') for f in m.get('features',[])]
for need in ['system.interconnect','system.storage','system.router']:
    assert need in feats, 'features 缺少 '+need
for k,v in m['router']['pages'].items():
    assert 'component' in v, 'router.pages.%s 缺少必填 component'%k
print('manifest OK: package=%s designWidth=%s deviceTypeList=%s'%(m['package'],m['config']['designWidth'],m['deviceTypeList']))
PY

# 2) 工具链：aiot-toolkit（全局）+ @aiot-toolkit/jsc（项目本地，生成 .jsc 字节码必需）
if ! command -v aiot >/dev/null 2>&1; then
  echo "---- 安装 aiot-toolkit ----"
  npm install -g aiot-toolkit
fi
echo "aiot-toolkit: $(aiot --version)"
if [ ! -d node_modules/@aiot-toolkit/jsc ]; then
  echo "---- 安装 @aiot-toolkit/jsc（项目本地）----"
  npm install @aiot-toolkit/jsc --no-save
fi

# 3) 签名判断：同源证书存在则出正式签名包
SIGN_OK=0
if [ -f sign/certificate.pem ] && [ -f sign/private.pem ]; then
  SIGN_OK=1
else
  echo "!! 未找到 sign/certificate.pem + sign/private.pem" >&2
  echo "   （PEM 含私钥，不进仓库，仅本地生成；debug 构建不受影响，但真机通信会被拒）" >&2
  echo "   生成：sh scripts/export_cert.sh" >&2
fi

# 4) 构建（Node 17+ 的 OpenSSL 3 兼容）
export NODE_OPTIONS=--openssl-legacy-provider
rm -rf dist build
if [ "$SIGN_OK" = "1" ]; then
  echo "---- aiot release --enable-jsc（同源正式签名 + .jsc 字节码）----"
  aiot release --enable-jsc
else
  echo "---- aiot build --enable-jsc（调试签名 + .jsc 字节码）----"
  aiot build --enable-jsc
fi

# 5) 统一产物名：com.lightningteam.suchmusic.<version>.rpk
VER="$(python3 -c "import json;print(json.load(open('src/manifest.json'))['versionName'])")"
SRC="$(ls dist/*.rpk 2>/dev/null | head -1 || true)"
if [ -n "$SRC" ]; then
  TARGET="dist/com.lightningteam.suchmusic.${VER}.rpk"
  if [ "$SRC" != "$TARGET" ]; then cp -f "$SRC" "$TARGET"; fi
  echo "---- 产物：$TARGET"
else
  echo "!! 未产出 .rpk，请检查上方日志" >&2
  exit 1
fi

echo "== 产物 =="
ls -la dist/*.rpk
