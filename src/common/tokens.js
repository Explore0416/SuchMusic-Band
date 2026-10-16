/**
 * tokens.js —— 设计令牌（手机基因 → 手环降级，设计文档 §5.2–§5.4）
 *
 * 坐标系：物理 212×520，`designWidth = 106` ⇒ **1 逻辑单位 = 2 物理 px**。
 * 本文件数值均为**逻辑值**（作者坐标系 106 宽），CSS 直接使用。
 *
 * @module common/tokens
 */
'use strict';

var TOKENS = {
  /** 颜色（§5.2） */
  color: {
    primary: '#2F84FE',
    bg: '#F1F2F4',
    card: '#FFFFFF',
    white: '#FFFFFF',
    text: '#333333',
    sub: '#838383',
    meta: '#999999',
    border: '#CCCCCC',
    divider: '#EEEEEE',
    disabled: '#CCCCCC',
    connected: '#2F84FE',
    disconnected: '#CCCCCC'
  },
  /** 圆角（§5.2，逻辑值；物理 16/20/32） */
  radius: {
    card: 16,
    button: 10,
    tag: 8,
    round: 999
  },
  /** 间距刻度（§5.4，逻辑值） */
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    pagePadH: 8,
    pagePadV: 8
  },
  /** 字号阶梯（§5.3，逻辑值） */
  font: {
    h1: 17,
    h2: 15,
    body: 13,
    caption: 12,
    meta: 10
  },
  /** 字重 */
  weight: {
    regular: 400,
    medium: 500,
    bold: 700
  },
  /** 触控 / 列表（§5.4，逻辑值） */
  touch: {
    secondary: 22,
    primary: 36,
    listItem: 44
  },
  /** 进度条高（§5.4，逻辑值） */
  progress: {
    height: 3
  },
  /** 布局（§5.5，逻辑值） */
  layout: {
    topBar: 32,
    cover: 44,
    bottomNav: 44,
    pageWidth: 106
  }
};

module.exports = { TOKENS: TOKENS };
