#!/usr/bin/env bash
#
# export_cert.sh —— 从手机 App 的 jks 导出配套 PEM（含私钥 + 证书）
#
# 依据设计文档 §6.2 / F9：
#   快应用「包名 + 签名」必须与手机 App 完全一致，否则通信被**静默拒绝**。
#   PEM 必须**同时包含私钥与证书**。
#
# ⚠️ 导出的 sign/sign.pem 含私钥，已在 .gitignore 中忽略，**切勿提交**。
#
# 用法：
#   sh scripts/export_cert.sh
#   KEYSTORE=/path/to.jks KEY_PROPS=/path/to/key.properties sh scripts/export_cert.sh
#
set -eu

# ---- 路径解析（可用环境变量覆盖） ----
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEYSTORE="${KEYSTORE:-/workspace/suchmusic/android/keystore/suchmusic-release.jks}"
KEY_PROPS="${KEY_PROPS:-/workspace/suchmusic/android/key.properties}"
OUT_PEM="${OUT_PEM:-$ROOT_DIR/sign/sign.pem}"
TMP_DIR="$(mktemp -d -t suchmusic-XXXXXX)"
TMP_P12="${TMP_P12:-$TMP_DIR/suchmusic.p12}"
# keytool -importkeystore 不接受已存在的空文件作为目标，确保路径不存在
rm -f "$TMP_P12"

echo "== SuchMusic 证书导出 =="
echo "keystore : $KEYSTORE"
echo "key.props: $KEY_PROPS"
echo "out pem  : $OUT_PEM"

[ -f "$KEYSTORE" ] || { echo "ERROR: 找不到 keystore: $KEYSTORE" >&2; exit 2; }
[ -f "$KEY_PROPS" ] || { echo "ERROR: 找不到 key.properties: $KEY_PROPS" >&2; exit 2; }

# ---- 从 key.properties 读取口令与别名 ----
STORE_PASS="$(grep -E '^storePassword=' "$KEY_PROPS" | cut -d'=' -f2- | tr -d '\r')"
KEY_PASS="$(grep -E '^keyPassword=' "$KEY_PROPS" | cut -d'=' -f2- | tr -d '\r')"
KEY_ALIAS="$(grep -E '^keyAlias=' "$KEY_PROPS" | cut -d'=' -f2- | tr -d '\r')"
[ -n "$STORE_PASS" ] || { echo "ERROR: key.properties 缺少 storePassword" >&2; exit 2; }
[ -n "$KEY_ALIAS" ] || { echo "ERROR: key.properties 缺少 keyAlias" >&2; exit 2; }
KEY_PASS="${KEY_PASS:-$STORE_PASS}"

# ---- 0) 指纹核实（应与设计文档一致） ----
echo "---- 0) 校验证书指纹 ----"
keytool -list -v -keystore "$KEYSTORE" -storepass "$STORE_PASS" -alias "$KEY_ALIAS" 2>/dev/null \
  | grep -E 'SHA1:|SHA256:|Alias name' || true

# ---- 1) jks(pkcs12) → p12 ----
echo "---- 1) jks → p12 ----"
keytool -importkeystore -noprompt \
  -srckeystore "$KEYSTORE" -srcstoretype PKCS12 -srcstorepass "$STORE_PASS" -srcalias "$KEY_ALIAS" -srckeypass "$KEY_PASS" \
  -destkeystore "$TMP_P12" -deststoretype PKCS12 -deststorepass "$STORE_PASS" -destkeypass "$STORE_PASS"

# ---- 2) p12 → pem（含私钥 + 证书） ----
echo "---- 2) p12 → pem ----"
mkdir -p "$(dirname "$OUT_PEM")"
openssl pkcs12 -nodes -in "$TMP_P12" -out "$OUT_PEM" -passin pass:"$STORE_PASS"

# ---- 3) 校验 PEM 同时含私钥与证书 ----
echo "---- 3) 校验 PEM 内容 ----"
BEGIN_COUNT="$(grep -c 'BEGIN' "$OUT_PEM" || true)"
echo "BEGIN 段数量 = $BEGIN_COUNT (期望 >= 2：PRIVATE KEY + CERTIFICATE)"
grep -q 'PRIVATE KEY' "$OUT_PEM" || { echo "ERROR: PEM 缺少私钥" >&2; exit 3; }
grep -q 'CERTIFICATE' "$OUT_PEM" || { echo "ERROR: PEM 缺少证书" >&2; exit 3; }

# ---- 清理临时 p12 ----
rm -rf "$TMP_DIR"

echo "== 完成：$OUT_PEM =="
echo "提示：该文件含私钥，已在 .gitignore 忽略；请勿提交到仓库。"
echo "提示：期望 SHA1 = 8E:7C:55:ED:E0:65:6F:BF:36:03:AC:BB:96:CB:2C:8B:6E:06:1B:46"
