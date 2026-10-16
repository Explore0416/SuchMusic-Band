#!/usr/bin/env bash
#
# export_cert.sh —— 从手机 App 的 jks 导出「同源签名」到手环 sign/ 目录
#   sign/certificate.pem（证书） + sign/private.pem（私钥）
#
# 关键约束：手环快应用必须与手机 App「包名 + 签名完全一致」，
#          否则 system.interconnect 会**静默拒绝**通信（不报错，只是不通）。
#          hap build 默认用工具链 debug 签名，故必须用手机 App 同源证书重签（见 build.sh 第 5 步）。
#
# ⚠️ 导出的 PEM 含私钥，已在 .gitignore 忽略，**切勿提交到仓库**。
#
# 用法：
#   sh scripts/export_cert.sh
#   KEYSTORE=/path/to.jks KEY_PROPS=/path/to/key.properties sh scripts/export_cert.sh
#
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEYSTORE="${KEYSTORE:-/workspace/suchmusic/android/keystore/suchmusic-release.jks}"
KEY_PROPS="${KEY_PROPS:-/workspace/suchmusic/android/key.properties}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/sign}"
TMP_DIR="$(mktemp -d -t suchmusic-XXXXXX)"
TMP_P12="$TMP_DIR/suchmusic.p12"
rm -f "$TMP_P12"

echo "== SuchMusic 证书导出 =="
echo "keystore : $KEYSTORE"
echo "key.props: $KEY_PROPS"
echo "out dir  : $OUT_DIR"

[ -f "$KEYSTORE" ] || { echo "ERROR: 找不到 keystore: $KEYSTORE" >&2; exit 2; }
[ -f "$KEY_PROPS" ] || { echo "ERROR: 找不到 key.properties: $KEY_PROPS" >&2; exit 2; }

STORE_PASS="$(grep -E '^storePassword=' "$KEY_PROPS" | cut -d'=' -f2- | tr -d '\r')"
KEY_PASS="$(grep -E '^keyPassword=' "$KEY_PROPS" | cut -d'=' -f2- | tr -d '\r')"
KEY_ALIAS="$(grep -E '^keyAlias=' "$KEY_PROPS" | cut -d'=' -f2- | tr -d '\r')"
[ -n "$STORE_PASS" ] || { echo "ERROR: key.properties 缺少 storePassword" >&2; exit 2; }
[ -n "$KEY_ALIAS" ] || { echo "ERROR: key.properties 缺少 keyAlias" >&2; exit 2; }
KEY_PASS="${KEY_PASS:-$STORE_PASS}"

echo "---- 0) 校验证书指纹（应=8E:7C:55:ED:E0:65:6F:BF:36:03:AC:BB:96:CB:2C:8B:6E:06:1B:46）----"
keytool -list -v -keystore "$KEYSTORE" -storepass "$STORE_PASS" -alias "$KEY_ALIAS" 2>/dev/null \
  | grep -E 'SHA1:|Alias name' || true

echo "---- 1) jks → p12 ----"
keytool -importkeystore -noprompt \
  -srckeystore "$KEYSTORE" -srcstoretype PKCS12 -srcstorepass "$STORE_PASS" -srcalias "$KEY_ALIAS" -srckeypass "$KEY_PASS" \
  -destkeystore "$TMP_P12" -deststoretype PKCS12 -deststorepass "$STORE_PASS" -destkeypass "$STORE_PASS"

echo "---- 2) p12 → 拆分 certificate.pem + private.pem ----"
mkdir -p "$OUT_DIR"
openssl pkcs12 -nodes -in "$TMP_P12" -passin "pass:$STORE_PASS" -out "$TMP_DIR/full.pem" >/dev/null 2>&1
python3 - "$TMP_DIR/full.pem" "$OUT_DIR" <<'PY'
import re, sys
pem = open(sys.argv[1]).read()
cert = re.search(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', pem, re.S).group(0)
key = re.search(r'-----BEGIN (?:RSA )?PRIVATE KEY-----.*?-----END (?:RSA )?PRIVATE KEY-----', pem, re.S).group(0)
open(sys.argv[2] + '/certificate.pem', 'w').write(cert + '\n')
open(sys.argv[2] + '/private.pem', 'w').write(key + '\n')
print('已导出 sign/certificate.pem + sign/private.pem（与手机 App 同源）')
PY

rm -rf "$TMP_DIR"
echo "== 完成：重跑 sh scripts/build.sh 将自动用该签名重签 .rpk =="
