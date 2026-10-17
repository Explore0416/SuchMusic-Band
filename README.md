# SuchMusic · 手环端（小米手环 10 · Vela JS 快应用）

在小米手环 10 上通过快应用控制 SuchMusic 手机端：**播放/暂停、上一首/下一首、搜索歌曲、切换播放模式、查看歌词、查看当前歌曲信息**。手环只经 `system.interconnect` 与手机通信，不发起任何 HTTP 请求。

- 协议与结构严格对齐设计文档：`/workspace/suchmusic/docs/ARCH-手环通信.md`（§3 协议 / §4 模块 / §5 UI / §6 交付 / §7 待验证）与 `docs/sequence-band.mermaid`。
- 协议**字段名/消息名/事件名已冻结**，本仓库未自创任何消息名。
- 视觉基因与手机版一致：主色 `#2F84FE`、页底 `#F1F2F4`、白卡片、圆角、副标题灰 `#838383`。

---

## 一、目录结构

```
suchmusic-band/
├── src/                       # 快应用源码（AIoT-IDE 打包根 = src/）
│   ├── manifest.json          # package=com.lightningteam.suchmusic, designWidth=106, deviceTypeList=["watch"]
│   ├── app.ux                 # 全局生命周期 + 冷启动即建连
│   ├── pages/
│   │   ├── index/index.ux     # 首页
│   │   ├── control/index.ux   # 控制页
│   │   ├── search/index.ux    # 搜索页
│   │   ├── mode/index.ux      # 播放模式页
│   │   └── lyric/index.ux     # 歌词页
│   ├── utils/                 # 运行时逻辑（单一真源）
│   │   ├── protocol.js        # 信封编解码 / 校验 / 版本·能力协商 / 错误码（纯逻辑）
│   │   ├── transfer.js        # 分片切分·组装 / CRC32 / NACK（纯逻辑）
│   │   ├── dedupe.js          # req.id LRU(64) 去重（纯逻辑）
│   │   ├── mode.js            # PlayMode ↔ 手环文案双向映射（纯逻辑）
│   │   ├── interconnect.js    # 连接封装（注入式适配器访问 system.interconnect）
│   │   ├── rpc.js             # 信封收发 / 超时重试 / 能力门控 / 分片派发
│   │   ├── state.js           # 全局播放状态（单一状态源，不发请求）
│   │   ├── store.js           # 受限持久化（仅 4 类键，<2KB）
│   │   └── format.js          # 时间 / 文本截断
│   ├── common/                # 设计令牌 + 常量 + 样式
│   │   ├── tokens.js
│   │   ├── const.js
│   │   ├── style.css
│   │   └── logo.png
│   └── assets/                # 预留小图标目录
├── scripts/
│   ├── export_cert.sh         # 从 jks 导出配套 PEM（含私钥）
│   ├── build.sh               # 校验 manifest + 调用 AIoT-IDE 打包
│   └── deploy.sh              # 侧载 .rpk 到小米手环 10
├── test/                      # Node 单元测试（零依赖）
│   ├── tinytest.js
│   ├── run.js
│   └── *.test.js
├── sign/                      # PEM 输出目录（已 .gitignore，仅 .gitkeep 入库）
├── .gitignore
├── package.json
└── README.md
```

> **说明**：运行时可 `require` 的纯逻辑模块**唯一真源**为 `src/utils/*.js`（`node test/*.test.js` 亦是**直接**引用 `../src/utils/`）。此前仓库根 `utils/` 的薄转发层已**删除**，避免「同一逻辑两处存在、易误改」的隐患（单一真源）。

---

## 二、实现的功能清单

| 页面 | 功能 | 对应协议 |
|---|---|---|
| `pages/index`（首页） | 当前歌名/艺人/专辑、进度、连接状态；▶/⏸、⏮、⏭；进入搜索/模式/歌词 | `playback.play`/`pause`/`prev`/`next` |
| `pages/control`（控制页） | 大按键播控、可点进度条 seek、模式快捷切换、播放列表入口 | `playback.*`、`playback.seek`、`playback.setMode`、`queue.play` |
| `pages/search`（搜索页） | 热搜 chip 点选即搜、最近搜索（≤5，可删）、结果列表；接收手机 `search.preset` | `search.hot`、`search.song`、`search.preset` |
| `pages/mode`（模式页） | 顺序/单曲/乱序单选 + 播放列表（当前高亮） | `playback.setMode`、`queue.play`、`player.mode`/`player.queue` |
| `pages/lyric`（歌词页） | 窗口歌词（≤12 行）当前行高亮、随播放滚动；离开即释放不落盘 | `lyric.window`、`lyric.line`、`lyric.meta` |

**通信层能力**：统一信封 `{v,id,type,method|event,payload,ts}`；`sys.hello`/`sys.hello_ack` 握手含版本与能力协商；分片 `header→data→end`（默认 900B/片、CRC32、`xfer.nack` 重传、组装上限 8KB）；接收端 `req.id` LRU(64) 去重；`player.progress` 1Hz 节流；`sys.ping` 10s 保活、`state.get` 15s 兜底重同步。

---

## 三、环境准备

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 14（建议 18.x） | 运行本仓库单元测试 / 构建脚本 |
| Java `keytool` | JDK 8+ | 证书指纹核实 / jks→p12 |
| `openssl` | 任意 | p12→PEM |
| aiot-toolkit（含 @aiot-toolkit/jsc） | 2.0.5 | 构建 `.rpk`（**官方 Vela 工具链**，产出 `.jsc` 字节码） |
| ADB（可选） | — | 若手环开放 adb 侧载 |
| 小米运动健康 App + 已配对的手环 10 | — | 侧载与真机联调 |
| 「Notify for Xiaomi」App（推荐） | — | 第三方快应用侧载 |

---

## 四、从零构建 `.rpk` 并侧载到小米手环 10（完整步骤）

> ℹ️ **`.rpk` 必须用官方 `aiot-toolkit` 构建并开 `--enable-jsc`**：手环运行的是 **aiot 字节码（`.jsc`）**，用手机端的 `hap-toolkit`（只产 `.js`）打出的包会**卡在启动页**。`build.sh` 已固化正确链路。仅**真机侧载**需要物理手环 10。

### 步骤 0 · 校验并导出证书（签名必须与手机 App 完全一致）

手环通信的硬约束：**快应用包名 + 签名必须与手机 App 完全一致**，否则通信被**静默拒绝**。

```bash
# 0.1 核实证书指纹（应与设计文档一致）
keytool -list -v -keystore /workspace/suchmusic/android/keystore/suchmusic-release.jks \
        -storepass "$(grep storePassword /workspace/suchmusic/android/key.properties | cut -d= -f2)" -alias suchmusic
#     期望 SHA1: 8E:7C:55:ED:E0:65:6F:BF:36:03:AC:BB:96:CB:2C:8B:6E:06:1B:46

# 0.2 从手机 App keystore 导出「同源」签名到 sign/（双文件）
cd suchmusic-band
sh scripts/export_cert.sh
#     产出 sign/certificate.pem（证书） + sign/private.pem（私钥）
```

> 🔒 `sign/*.pem` 含私钥，已被 `.gitignore` 忽略，**请勿提交**（`git status` 不应出现 `*.pem`）。

### 步骤 1 · 一条命令完成「校验 + 构建 + 同源重签」

```bash
cd suchmusic-band
sh scripts/build.sh
#   内部：校验 manifest → 安装 hap 工具链 → hap build → 用 sign/*.pem 同源重签
#   产物： dist/com.lightningteam.suchmusic.1.0.0.rpk（已去 debug 后缀、与手机 App 同源）
```

> **为什么必须重签**：`hap build` 默认用工具链**内置 debug 签名**，而 `system.interconnect` 要求手环快应用与手机 App「包名 + 签名完全一致」，否则**静默拒绝**通信。`build.sh` 会自动用步骤 0 导出的同源证书完成重签。
>
> Node 17+ 需 `--openssl-legacy-provider`（webpack 旧哈希与 OpenSSL 3 不兼容），`build.sh` 已自动设置。

### 步骤 2 · 侧载到手环 10

```text
方式 a（推荐）：Notify for Xiaomi → 设备 → Third-party app → 上传该 .rpk
方式 b：小米运动健康 App 开发者模式（若开放）
方式 c：adb（若手环开放）：sh scripts/deploy.sh dist/xxx.rpk
```

> ⚠️ **若手环上已装过旧版本：请先卸载再安装。** Vela 会缓存旧版本，与包名相同的 rpk 仅靠 `versionCode` 递增有时不足以替换，可能仍运行旧版本（表现为启动异常）。

### 步骤 3 · 验证

手环应用列表出现「**SuchMusic**」→ 打开 → **先在手机播放一首歌** → 首页应显示当前歌曲、艺人、进度。

### 步骤 4（可选）· 交给 CI 自动产出

本仓库内置工作流 `.github/workflows/build-rpk.yml`：push / PR / 打标签时自动**构建 + 同源重签** `.rpk`，上传为 Artifact；打 `v*` 标签时同时发布到 Release。

启用同源重签需在**本仓库** Actions secrets 配置两项（值用 `scripts/print_secrets.sh` 生成）：

| Secret | 内容 | 生成方式 |
|---|---|---|
| `BAND_SIGN_CERT_B64` | `sign/certificate.pem` 的 base64 | `sh scripts/print_secrets.sh` 输出第一段 |
| `BAND_SIGN_KEY_B64` | `sign/private.pem` 的 base64 | `sh scripts/print_secrets.sh` 输出第二段 |

> 路径：Repo → Settings → Secrets and variables → Actions → New repository secret。
> 未配置 secret（如公开 fork）时工作流自动跳过重签，产物为 debug 签名，构建仍通过。

---

## 五、真机人工验收清单（对照设计文档 §6.3，逐条）

| # | 操作 | 预期结果 |
|---|---|---|
| A1 | 手机播放一首歌 → 打开手环 SuchMusic | 首页显示歌名/艺人/进度，与手机一致 |
| A2 | 手环点 ▶/⏸ | 手机同步播放/暂停；手环图标切换 |
| A3 | 手环点 ⏭ | 手机切下一首；手环**立即**刷新为新歌（无重复切歌） |
| A4 | 手环点 ⏮ | 手机切上一首 |
| A5 | 手环拖动/点按进度条 | 手机 `seek` 到对应位置 |
| A6 | 手环搜索页点热搜词 → 点某条结果 | 返回结果列表；点某条 → 手机开始播放该曲 |
| A7 | 手机搜索页「发送到手环」 | 手环搜索页出现该关键词并自动搜索 |
| A8 | 手环模式页选「单曲循环」 | 手机 `PlayMode` 变为 `single`；曲终自动重播 |
| A9 | 打开手环歌词页 | 显示当前行高亮 + 上下 ±N 行；随播放滚动 |
| A10 | 断连（手机蓝牙关闭 3s 后恢复） | 手环显示「未连接」→ 自动重连 → 首页状态重同步 |
| A11 | 重复点击 ⏭ 快速 5 次 | 每次只切一首（幂等生效，不跳多首） |
| A12 | Windows 端经手机连接 | Windows 能控制播放并显示当前歌曲；断开手机则 Windows 失联 |
| A13 | 手环重启后查看 | 搜索历史仍在（≤5），其余无残留占位 |

---

## 六、与手机端联调的排查顺序

按以下顺序逐项排查（任一项不满足都会导致**静默失败**）：

1. **包名一致**：`src/manifest.json` 的 `package` 必须为 `com.lightningteam.suchmusic`（与手机 App 相同）。
2. **签名一致**：`.rpk` 使用的 PEM 必须由 `suchmusic-release.jks` 导出（SHA1 `8E:7C:…:46`）；PEM 必须含**私钥**。
3. **快应用是否安装**：手环应用列表应有「SuchMusic」；用 `interconnect` 的 `diagnosis`（`0 OK / 1001 未安装 / 204 超时`）判断。
4. **权限**：手机端需 `Permission.DEVICE_MANAGER` 授予（在手机 App 侧）。
5. **连接状态**：手环进入页面常先得到 `DISCONNECTED`（F3），需等 2s 轮询；`onopen` 后才发 `sys.hello`。
6. **握手日志**：两端各打印握手日志，确认 `sys.hello` → `sys.hello_ack` → `state.get` 全链路。
7. **能力协商**：确认 `caps` 取交集后含所需能力（如 `lyric`/`playmode`），否则对应页面/命令被门控不发。

---

## 七、待验证项（按设计文档给定保守默认实现）

| 编号 | 待验证项 | 本仓库采用的保守默认 |
|---|---|---|
| V1 | `interconnect.send({data})` 的 `data` 为 String 还是 Object | 默认传 **String**（`createLink` 提供 `sendAsObject` 开关可切换） |
| V2 | 单包字节上限 `chunkMaxBytes` 真实值 | **900B**（`transfer.CHUNK_MAX_BYTES`，可在两端配置常量） |
| V2b | `DEVICE_MANAGER` 是否需额外清单声明 | 手机端事项，本仓不涉及 |
| V4 | 手环存储可用配额 | 持久化**仅 4 类键、<2KB**（`store` 内置断言） |
| V5 | 封面解码性能/内存 | 封面用**小图（≤96px）或纯色占位**，列表虚拟化 |
| V6 | 重连 `onopen(isReconnected=true)` 可靠性 | 重连后**重新 `sys.hello` + `state.get`** |
| V7/V8 | 上游接口差异 / 音量能力 | `volume` 为 Phase 2；手环端已实现 `playback.setVolume` 但无 UI 入口 |

组装上限 `assembleMaxBytes = 8192`（§3.8），超限回落 `E_TOOLARGE`。

---

## 八、本沙箱可自动验证项（真实命令）

```bash
# 1) 全量单元测试（Node，零依赖）
npm test                      # = node test/run.js
node test/protocol.test.js    # 亦可单文件运行

# 2) 纯逻辑模块可被 Node 直接加载（单一真源 src/utils/）
node -e "require('./src/utils/protocol.js'); console.log('ok')"

# 3) JSON 合法性
python3 -m json.tool src/manifest.json > /dev/null && echo OK
python3 -m json.tool package.json > /dev/null && echo OK
```

沙箱内**可构建**：`.rpk`（`hap build`，见 §四，实测 EXIT=0）。沙箱内**无法验证**：`system.interconnect` 运行时、真实 BLE 分片吞吐（须真机）。

---

## 九、与设计文档的偏差（Deviation）

| # | 偏差 | 原因 / 处理 |
|---|---|---|
| D-layout | 设计文档把运行时逻辑放在 `src/utils/`；本任务曾额外要求根 `utils/` 提供 Node 可 `require` 的纯逻辑模块 | 采用**单一真源** `src/utils/`：测试直接引用 `../src/utils/`，并**删除**根 `utils/` 转发层（避免逻辑两处存在、易误改） |
| D-count | 任务简述「18 个方法」，设计文档 §3.5 方法表实为 **20 个**方法名 | 以**设计文档为准**，实现全部 20 个（含 `sys.hello`/`sys.ping`/`playback.setVolume`/`cover.get`），未自创任何方法名 |
| E1 | 搜索结果点按播放：§5③ 引用 `playAndAdd`，但 §3.5 冻结清单**无该方法名** | 为避免自创消息名，手环以 `queue.play{index}` 表达「播放第 index 条搜索结果」。**需手机端配合**：将选中搜索结果并入队列后定位；请手机端确认该约定（或补充正式方法名） |
| E2 | 播放列表显示：§5④ 线框含歌名，但协议仅提供 `queue.{count,currentIndex}`（无「队列明细」方法） | 手环列表以 `第 N 首` 占位 + 当前项高亮；如需歌名，需新增「队列明细」方法（当前不做，避免自创） |
| E3 | 进度条 seek 依赖触点坐标 | 无 Canvas，采用 `<div>` 宽度实现；点击/拖动坐标经 `touches[0].clientX`/`offsetX` 换算，真机手势坐标系需实测微调 |
| E4 | 搜索历史删除：§5③ 为「右滑删除」 | 因 `<list-item>` 手势兼容性不确定，提供「✕」删除入口作为稳妥实现 |

---

## 十、免责与声明

- 本仓库仅含**手环端**（Vela JS 快应用）。手机端桥接（Kotlin/Dart）、Windows 端（Electron）为其它工作区职责。
- 未修改 `/workspace/suchmusic/` 下任何文件。
- 不引入任何第三方依赖。
- `.rpk` 由官方 `aiot-toolkit` 命令行构建（`--enable-jsc`，产出 `.jsc` 字节码）；仅真机侧载需物理手环 10。
