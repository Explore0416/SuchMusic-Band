/**
 * ui.js —— 页面交互小工具
 *
 * 统一的「未连接提示」：任何依赖手机链路的操作在离线时都给出 Toast 反馈，
 * 杜绝「点了没反应」的感知（离线时 RPC 本身就是 no-op，用户看不到任何变化）。
 *
 * @module utils/ui
 */
'use strict';

var prompt = null;

function getPrompt() {
  if (prompt) { return prompt; }
  try {
    prompt = require('@system.prompt');
  } catch (e) {
    prompt = null;
  }
  return prompt;
}

/**
 * 未连接时弹提示。返回 true 表示当前离线且已提示（调用方应中断操作）。
 *
 * 文案与 `common/const.js` 的 `LINK_TEXT` 保持同一套口径：
 * - `appMissing`（interconnect 错误码 1001）→ 手机没装 App
 * - 其余未就绪 → 通道未建立（多为 App 未在前台/后台运行）
 *
 * @param {object} state 全局状态模块
 * @returns {boolean}
 */
function offlineToast(state) {
  var s = state.get();
  if (s.link === 'ready') { return false; }
  var p = getPrompt();
  var msg = s.link === 'appMissing'
    ? '手机未安装 SuchMusic'
    : '未连接手机，请在手机上打开 SuchMusic';
  if (p && typeof p.showToast === 'function') {
    try {
      p.showToast({ message: msg });
    } catch (e) {
      // Toast 失败不影响主流程
    }
  }
  return true;
}

module.exports = {
  offlineToast: offlineToast
};
