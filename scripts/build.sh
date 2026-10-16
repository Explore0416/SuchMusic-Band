#!/usr/bin/env bash
#
# build.sh —— 构建 .rpk（命令行，无需 GUI IDE）
#
# 事实：快应用 .rpk 由**公开 npm 工具链 hap-toolkit-xiaomi** 构建，
#       AIoT-IDE 仅是它的可视化外壳（VS Code 套壳）。
#       真机侧载仍需物理手环 10（物理限制），但构建本身纯 CLI 可完成。
#
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "== SuchMusic 手环端构建 =="

# 1) 前置校验：manifest 包名 / designWidth / router 规范
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
for k,v in m['router']['pages'].items():
    assert 'component' in v, 'router.pages.%s 缺少必填 component'%k
print('manifest OK: package=%s designWidth=%s deviceTypeList=%s'%(m['package'],m['config']['designWidth'],m['deviceTypeList']))
PY

# 2) 工具链：缺失则自动安装
if ! command -v hap >/dev/null 2>&1; then
  echo "---- 未检测到 hap 工具链，安装 hap-toolkit-xiaomi ----"
  npm install -g hap-toolkit-xiaomi
fi
echo "hap-toolkit: $(hap --version)"

# 3) 签名预检：手环快应用需与手机 App 同源签名，否则 system.interconnect 拒绝通信
SIGN_OK=0
if [ -f sign/certificate.pem ] && [ -f sign/private.pem ]; then
  SIGN_OK=1
else
  echo "!! 未找到 sign/certificate.pem + sign/private.pem" >&2
  echo "   （PEM 含私钥，不进仓库，仅本地生成；debug 构建不受影响，但真机通信会被拒）" >&2
  echo "   生成：sh scripts/export_cert.sh" >&2
fi

# 4) 构建（Node 17+ 的 OpenSSL 3 与 webpack 旧哈希不兼容，需 legacy provider）
export NODE_OPTIONS=--openssl-legacy-provider
echo "---- hap build ----"
hap build

# 5) 重签（同源正式签名）：hap build 默认使用工具链内置 debug 签名，须用手机 App 同源证书重签
if [ "$SIGN_OK" = "1" ]; then
  echo "---- 用同源正式签名重签 .rpk ----"
  export HAP_PKG_DIR="$(npm root -g)/hap-toolkit-xiaomi/node_modules/@hap-toolkit-xiaomi/packager/lib"
  node -e '
    const fs=require("fs"),path=require("path");
    const {signForRpk}=require(path.join(process.env.HAP_PKG_DIR,"index.js"));
    const root=process.cwd();
    const cert=fs.readFileSync(path.join(root,"sign/certificate.pem"),"utf8");
    const priv=fs.readFileSync(path.join(root,"sign/private.pem"),"utf8");
    const src=path.join(root,"dist","com.lightningteam.suchmusic.debug.1.0.0.rpk");
    if(!fs.existsSync(src)){console.error("未找到待重签 rpk:",src);process.exit(1);}
    signForRpk(fs.readFileSync(src),priv,cert).then(out=>{
      const dest=path.join(root,"dist","com.lightningteam.suchmusic.1.0.0.rpk");
      fs.writeFileSync(dest,out);
      console.log("RESIGNED ->",dest,out.length,"bytes");
    }).catch(e=>{console.error("重签失败:",e.message);process.exit(1);});
  '
else
  echo "!! 跳过重签：未提供同源签名，产物为 debug 签名，真机通信会被拒" >&2
fi

echo "== 产物 =="
ls -la dist/*.rpk 2>/dev/null || echo "（未产出 .rpk，请检查上方日志）"
