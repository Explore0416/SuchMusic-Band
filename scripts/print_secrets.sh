#!/usr/bin/env bash
#
# print_secrets.sh —— 生成 CI 所需 secrets 的 base64 值
#
# 手环仓库 CI（.github/workflows/build-rpk.yml）需要两个 secret：
#   BAND_SIGN_CERT_B64 —— sign/certificate.pem 的 base64
#   BAND_SIGN_KEY_B64  —— sign/private.pem 的 base64
#
# 这两个文件由手机 App 的 keystore 导出（scripts/export_cert.sh），
# 与手机 App **同源**。把它们 base64 后存入 GitHub Actions secrets 即可。
#
# ⚠️ 输出含**私钥**，仅可粘贴进你自己的私有仓库 secrets，切勿外传、切勿提交。
#
# 用法：
#   sh scripts/print_secrets.sh
#
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# 若 sign/*.pem 不存在，先从手机 App keystore 导出
if [ ! -f sign/certificate.pem ] || [ ! -f sign/private.pem ]; then
  echo "== sign/*.pem 不存在，先执行 export_cert.sh =="
  sh scripts/export_cert.sh
fi

echo
echo "=========================================================="
echo " 把下面两条分别粘贴到 SuchMusic-Band 仓库的 Actions secrets"
echo " 路径：Repo → Settings → Secrets and variables → Actions → New repository secret"
echo "=========================================================="
echo
echo "----- BAND_SIGN_CERT_B64 -----"
base64 -w0 sign/certificate.pem 2>/dev/null || base64 sign/certificate.pem | tr -d '\n'
echo
echo
echo "----- BAND_SIGN_KEY_B64 -----"
base64 -w0 sign/private.pem 2>/dev/null || base64 sign/private.pem | tr -d '\n'
echo
echo
echo "=========================================================="
echo " 校验（证书指纹应 = 手机 App 的 8E:7C:55:...）："
openssl x509 -in sign/certificate.pem -noout -fingerprint -sha1
echo "=========================================================="
