# 上游 webadb（Tango / ya-webadb）无线调试能力调研与适配方案

调研日期：2026-09-25
调研对象：`yume-chan/ya-webadb`（项目名 Tango），本仓库依赖 `@yume-chan/adb@2.6.4`、`@yume-chan/adb-daemon-webusb@2.3.2`、`@yume-chan/adb-scrcpy@2.3.2`

## 1. 结论速览

| 问题 | 结论 |
| --- | --- |
| 上游是否支持 adb over wifi（TCP 5555） | 协议层支持，官方提供 `AdbDaemonDirectSocketsDevice` 参考实现；**Web 平台不支持**（浏览器无裸 TCP），Node.js 支持 |
| 上游是否支持 Android 11+ 无线调试（mDNS + 配对 + TLS） | **不支持，未实现**（依赖完整 TLS 实现），issue #784 仍 open |
| 本仓库能否适配 | 能。ADB daemon 协议与传输层解耦，认证（RSA）与上层能力（scrcpy、文件管理）全部可复用；卡点在浏览器能力，不在协议 |
| 推荐方案 | WebSocket 桥接 + 直连 5555（legacy ADB over Wi-Fi），前端仅新增一个 `AdbDaemonConnection` 实现 |

## 2. 上游现状（事实与出处）

### 2.1 官方传输层定义

`AdbDaemonTransport` 文档明确三种 daemon 连接，并给出平台矩阵（https://tangoadb.dev/tango/daemon/ ）：

- **USB**：Chromium（WebUSB）✅ / Node.js ✅
- **ADB over Wi-Fi（TCP/IP mode）**：Web ❌ / Node.js ✅ —— "Currently, there is no built-in TCP connection for Web platforms, as TCP sockets are not supported there."
- **Wireless Debugging（Android 11+）**：**"not implemented yet, as it needs a full TLS implementation"**，作者称尚未找到合适的 TLS 库

同一页明确：TCP 上的数据协议与 USB **完全一致**，只是传输层不同；且 `AdbDaemonTransport` 接受任意自定义 connection（例如 WebSocket 转发）。

### 2.2 上游包清单

`libraries/` 目录（GitHub API 实查，2026-09-25）中**没有任何 TCP / WebSocket / Direct Sockets 后端**，只有：

```
adb  adb-daemon-webusb  adb-server-node-tcp  adb-credential-web  adb-credential-nodejs
adb-scrcpy  scrcpy  scrcpy-decoder-*  android-bin  aoa  struct  stream-extra  ...
```

npm 上 `@yume-chan/adb-backend-direct-socket` / `@yume-chan/adb-backend-websocket` 均 404，从未发布。

### 2.3 Direct Sockets 路线已实质搁置

- 上游 issue #349「Help test the raw TCP wireless backend」2021 年开、2023-01 关闭。维护者结论：Direct Sockets 新安全模型（isolated app / 打包签名安装）"fundamentally breaking"，且 Chrome 在该模型下未实现 WebUSB，两者无法共存。
- 现状（2026）：Direct Sockets 仅对 **Isolated Web App（IWA）** 开放，Chrome 131 起 IWA 默认可用，实际主要落在 ChromeOS、企业策略场景；M151 起权限策略拆成 `local-network` / `loopback-network`。Firefox 明确 negative，Safari 无信号。
- 结论：对一个部署在 GitHub Pages 的普通静态站点，**Direct Sockets 不可用**。

### 2.4 Android 11+ 无线调试：上游 open issue #784

- 状态：open（2025-08 至今）。维护者回复要点：
  - 无线调试需要 mDNS 发现 + 配对（SPAKE2）+ **TLS 客户端证书**，他本人不做，改用 Google ADB server 走 Server Transport；
  - **core 包里已经有能力**：`libraries/adb/src/server/commands/wireless.ts`（`pair` / `connect` / `disconnect`）与 `m-dns.ts`（`getServices`），即通过 Google ADB server 客户端即可完成无线配对与发现；
  - TLS 实现待定（提到 `reclaimprotocol/tls` 作为跨运行时候选），mDNS 库也待定；
  - v3 已把认证流程从 `AdbDaemonTransport` 中拆出为 `AdbDaemonAuthenticator`（#810），未来便于加无线调试 authenticator。
- 至今（2026-09）无实现落地。

## 3. 本仓库现状

- `src/components/Scrcpy/adb-client.ts`：唯一连接入口，`AdbDaemonWebUsbDeviceManager` + `AdbDaemonTransport.authenticate` + `AdbWebCredentialStore`，只有 WebUSB 一条路。
- `src/components/Device/PairedDevices.vue`：设备列表仅 `usbDeviceList`。
- 全仓库 `src/` 中 `wifi` / `tcpip` / `websocket` / `5555` **零命中**，无任何无线相关代码。

## 4. 协议与架构可行性分析

### 4.1 有利面（改动成本低的部分）

1. **传输无关**：`AdbDaemonConnection = ReadableWritablePair<AdbPacketData, Consumable<AdbPacketInit>>`。只要提供一对字节流，上层 `Adb`、`AdbSync`、文件管理、shell、scrcpy 全部零改动。
2. **序列化工具现成**：`StructDeserializeStream(AdbPacket)`、`AdbPacketSerializeStream`、`Consumable.WritableStream` 都在 `@yume-chan/adb` + `@yume-chan/stream-extra` 里。
3. **认证可复用**：TCP 5555 模式与 USB 一样走 `AUTH TOKEN / SIGNATURE`（RSA 2048），现有 `AdbWebCredentialStore` 直接可用，无需新增认证协议。
4. **scrcpy 不需要额外端口**：`AdbScrcpyForwardConnection` / `AdbScrcpyReverseConnection` 走 ADB 隧道（forward/reverse），视频/音频/控制流都复用同一条 ADB 连接。
5. **高延迟已有考虑**：`AdbDaemonTransport.authenticate` 提供 `initialDelayedAckBytes`（Android 14+ delayed ack），正是为 Wi-Fi 这类高延迟链路设计的。

### 4.2 阻塞面（真正的难点）

| 阻塞项 | 说明 | 影响 |
| --- | --- | --- |
| 浏览器无裸 TCP | 标准 Web 平台只有 HTTP / WebSocket / WebRTC / WebTransport，无法连 `192.168.x.x:5555` | 必须引入桥接，或运行在 IWA/Electron |
| TLS 客户端证书 | Android 11+ 无线调试要求 TLS 双向认证；WebSocket/WebTransport 无法携带客户端证书 | 要在 JS/WASM 内实现 TLS 1.3，成本极高 |
| mDNS 不可用 | 浏览器无组播 DNS-SD | 无线调试的设备发现只能退化为手工填 IP + 端口 |
| Local Network Access | Chrome 142 起对 fetch/子资源、147 起对 WebSocket/WebTransport 施加 LNA 限制；公开源站访问本地/回环地址需权限或策略放行 | 桥接方案在 Chrome 147+ 可能被拦（部分场景无用户提示，直接 `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`） |
| 混合内容 | HTTPS 页面连接 `ws://` 会被拦 | 桥需 `wss://`，回环证书要可信（如 mkcert），或页面走 `http://localhost` |
| 安全 | `adb tcpip 5555` 无鉴权，同网段任何人可连 | 仅适合可信内网，需在 UI 明确提示 |

## 5. 适配方案

### 方案 P1（推荐，先落地）：WebSocket 桥 + legacy ADB over Wi-Fi

适用：Android 任意版本，先用 USB 连一次执行 `adb tcpip 5555`（或已 root 设备设置 `service.adb.tcp.port`），之后同网段直连。

链路：

```
浏览器（静态站点）──WebSocket(wss)──> 桥（本机 websockify / 设备端 Termux websockify）──TCP──> 设备 adbd:5555
```

改动清单（预估 3~4 个文件、200~300 行）：

1. 新增 Wi-Fi 连接实现（如 `src/components/Scrcpy/wifi-connection.ts`）
   - 建 `WebSocket(url)`，`binaryType = 'arraybuffer'`
   - 收：`PushReadableStream<Uint8Array>` → `pipeThrough(new StructDeserializeStream(AdbPacket))`
   - 发：`Consumable.WritableStream<Uint8Array>`（write 内 `ws.send`）→ `bePipedThroughFrom(new AdbPacketSerializeStream())`
   - 关闭：ws.close → readable 收尾，异常统一成 `NetworkError`（`adb-client.ts` 已有该分支）
2. `adb-client.ts`：扩展 `DeviceMeta`（`serial` 用 `host:port`）或新增 `connectWifi(host, port)`；`initialDelayedAckBytes` 适度调大
3. `PairedDevices.vue`：设备列表增加「通过 Wi-Fi 添加设备」入口（IP + 端口，默认 5555），复用现有连接/重连/错误恢复逻辑
4. 引导文案：说明需先 `adb tcpip 5555`、需同网段、重启后失效、同网段无鉴权风险

### 方案 P2（能力补全，可选）：WebSocket 桥 + Google ADB Server

链路：`浏览器 ──WebSocket──> 本机 adb server:5037 ──> 设备（含 Android 11+ 无线调试配对）`

- 复用依赖包内已有的 `AdbServerClient`（`wireless.pair()` / `wireless.connect()` / `mDns.getServices()`）与 `AdbServerTransport`，**配对与发现全部由 Google ADB server 完成**，前端只需实现 `AdbServerClient.ServerConnector`（`connect` + `addReverseTunnel` / `removeReverseTunnel` / `clearReverseTunnels`）over WebSocket。
- 代价：用户机器必须安装并常驻 Google ADB；且 adb server 会占用 USB 设备，与现有 WebUSB 独占模式互斥（同一时刻二选一）。
- 收益：一次接入即可覆盖 Android 11+ 官方无线调试（配对码/QR、mDNS 发现）。

### 方案 P3（不建议自研）：纯前端实现 Android 11+ 无线调试

- 需在 JS 内实现 SPAKE2 配对 + TLS 1.3（含客户端证书）；即使全部实现，仍受浏览器无裸 TCP 限制，只在 IWA / Electron / 设备端内嵌 WebView 才有意义。投入产出比差，且未来上游若发布该能力会重复投入。

### 落地顺序建议

1. P1（自研，可控、无上游依赖）→ 打通「Wi-Fi 连接 + 投屏 + 文件管理」完整链路
2. 观察上游 #784 进展（v3 的 `AdbDaemonAuthenticator` 是明确的接入点），不要提前押注
3. 若确有 Android 11+ 无线调试刚需，再评估 P2（借 Google ADB server），而非 P3

## 6. 风险登记

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| 依赖用户侧桥程序，破坏「零安装」体验 | 高 | 提供一键脚本/说明；优先本机 websockify，移动场景用设备端 Termux |
| Chrome 147+ LNA 拦截本地 WebSocket | 高 | 实测确认是否有权限提示；必要时引导 `LocalNetworkAccessAllowedForUrls` 策略，或改用本机 http 同源部署 |
| HTTPS 页面连 `ws://` 被混合内容拦截 | 中 | 桥提供 `wss://`，用 mkcert 生成本地可信证书；或本地以 `http://localhost` 打开 |
| Wi-Fi 带宽导致投屏卡顿（视频流经 ADB 隧道） | 中 | 降分辨率/码率；开启 delayed ack；提示 5GHz 网络 |
| `adb tcpip 5555` 无鉴权，同网段任何人可连 | 中 | UI 明确风险提示，仅建议可信内网使用 |
| 设备重启/换网后端口失效 | 低 | 引导文案 + 断线重连策略复用现有 `autoReconnectAttempts` |
| 上游 v3 API 变更（认证拆分、密钥格式变化） | 低 | 升级前对齐 migration；Wi-Fi 连接实现只依赖稳定接口（packet 流 + credential store） |

## 7. P1 与 P2 详细实现方案

### 7.1 方案 P1：WebSocket 桥 + 直连 adbd 5555

#### 核心思路

不改动任何 ADB 协议代码，只补一个「WebSocket 字节流 → `AdbDaemonConnection`」的适配器，交给现成的 `AdbDaemonTransport.authenticate` 处理。TCP 5555 上的 ADB 报文与 USB 完全一致，认证仍是 RSA（TOKEN/SIGNATURE），因此上层 `Adb` / 文件管理 / shell / scrcpy 全部零改动。

#### 关键步骤

1. **设备端开口**：USB 连一次后执行 `adb tcpip 5555`（Android 11+ 同样可用），或已 root 设备 `setprop service.adb.tcp.port 5555` + `stop adbd && start adbd`。重启后失效，需重做。
2. **起桥**：PC 端 `websockify 8888 <设备IP>:5555`，或设备端 Termux `websockify 8888 127.0.0.1:5555`（Chrome for Android 场景）。桥必须透传二进制帧，禁止任何文本编解码。
3. **前端连接实现**（新增一个文件即可）：
   - `ws.binaryType = 'arraybuffer'`
   - 读：`new PushReadableStream<Uint8Array>()`（onmessage 入队 / onclose 收尾 / onerror 抛错）→ `pipeThrough(new StructDeserializeStream(AdbPacket))`
   - 写：`new Consumable.WritableStream<Uint8Array>({ write: chunk => ws.send(chunk) })`，外包 `new WrapWritableStream(...).bePipedThroughFrom(new AdbPacketSerializeStream())`
   - 断开/异常统一转成 `NetworkError`（`adb-client.ts` 已有该分支，可复用）
4. **接入现有入口**：`DeviceMeta` 形状已是 `{ serial, connect }`，`serial` 填 `host:port`，`connect` 返回上面的流对 → `AdbClient.connect` 不需要改签名。
   - `AdbDaemonTransport.authenticate` 的 `initialDelayedAckBytes` 建议设 64KB~256KB（Android 14+ 生效，老设备自动忽略），改善高延迟吞吐。
5. **scrcpy 无需改动**：默认 `tunnelForward` 未开启 → 走 `AdbScrcpyReverseConnection`，`adb reverse` + 设备回连，视频/音频/控制全部复用同一条 ADB 连接，不需要浏览器再开任何端口。
6. **UI**：`PairedDevices.vue` 增加「通过 Wi-Fi 添加设备」（IP + 端口，默认 5555），复用现有连接/重连/`isTransportOccupiedError` 逻辑。

#### 依赖清单与版本/配置要求

| 类别 | 依赖 | 版本 / 配置要求 |
| --- | --- | --- |
| 现成库 | `@yume-chan/adb` | 2.6.4（已装）：`AdbDaemonTransport`、`AdbPacket`、`AdbPacketSerializeStream`、server 可选 |
| 现成库 | `@yume-chan/stream-extra` | 2.6.1（已装）：`PushReadableStream`、`Consumable`、`WrapWritableStream`、`StructDeserializeStream` |
| 现成库 | `@yume-chan/adb-credential-web` | 2.1.0（已装）：RSA 2048 凭据存储（WebCrypto + 本地存储），TCP 模式直接复用 |
| 运行时 | Chromium 系浏览器 | 同现有 WebUSB 要求；Secure Context（https 或 localhost） |
| 外部服务 | websockify（Python 3）或 `ws`（Node 18+） | 纯 TCP 透传，无协议转换；可跑在 PC 或设备端 Termux |
| 浏览器策略 | Secure Context + 混合内容 | 页面为 https 时桥必须 `wss://`，回环证书需受信任（mkcert） |
| 浏览器策略 | Local Network Access | Chrome 147+ 对 WebSocket 生效；公开源站→本地/回环可能被拦，需实测，必要时 `LocalNetworkAccessAllowedForUrls` 或改用同地址空间部署（`http://localhost` 跑 dev） |
| 设备 | adbd 监听 5555 | 任意 Android 版本；与浏览器同网段，AP 隔离/访客网络会失败 |

---

### 7.2 方案 P2：WebSocket 桥 + 本机 Google ADB Server（5037）

#### 核心思路

浏览器不直连 adbd，而是把字节流接到本机 ADB server，改用 core 包里已有的 `AdbServerClient` + `AdbServerTransport`。**Android 11+ 无线调试的配对（SPAKE2）、mDNS 发现、TLS 全部由 Google ADB server 完成**，前端只负责发命令和搬流。

#### 关键步骤

1. **准备 ADB server**：安装 platform-tools（需支持 `adb pair`，建议 adb ≥ 31；mDNS 支持在 Windows 上要较新版本），`adb start-server` 监听 `127.0.0.1:5037`。
2. **起桥**：WS → `127.0.0.1:5037`。**关键差异**：ADB server 协议是「一次连接 = 一条命令 / 一条流」，`ServerConnector.connect()` 每次调用都要新建一条连接（参考 `AdbServerNodeTcpConnector`）。桥必须支持：
   - 多并发 WS（每条 WS 对应一条到 5037 的 TCP），或
   - 单 WS 上自定义多路复用（stream id 分包，桥侧拆流）
3. **实现 `AdbServerClient.ServerConnector`**（4 个方法）：`connect()`、`addReverseTunnel(handler, address)`、`removeReverseTunnel()`、`clearReverseTunnels()`。
   - **反向隧道（scrcpy 默认模式）要求 connector 能在 ADB 主机上监听端口并接受设备回连** → 桥需额外支持 listen/accept 指令。
   - 简化做法：scrcpy 选项设 `tunnelForward: true`，走 `adb.createSocket('localabstract:scrcpy...')`，不需要监听，桥只需普通连接能力。
4. **发现与配对**：`mDns.check()` → `mDns.getServices()`（列出 `_adb-tls-pairing._tcp` / `_adb-tls-connect._tcp`）→ `wireless.pair(host:pairPort, code)` → `wireless.connect(host:port)`。
5. **建传输**：`client.createTransport({ serial })` 或 `client.createAdb(...)` 得到 `AdbServerTransport` / `Adb`，上层逻辑与 daemon 模式一致。

#### 依赖清单与版本/配置要求

| 类别 | 依赖 | 版本 / 配置要求 |
| --- | --- | --- |
| 现成库 | `@yume-chan/adb` 2.6.4 | `AdbServerClient`（含 `wireless.pair/connect/disconnect`、`mDns.getServices`）、`AdbServerTransport` —— **无需新增 npm 包** |
| 现成库 | `@yume-chan/stream-extra` 2.6.1 | 同 P1，构造 `ServerConnection`（`ReadableWritablePair<Uint8Array, MaybeConsumable<Uint8Array>>` + `closed` + `close`） |
| 外部服务 | Google ADB server（platform-tools） | 常驻 5037；`adb pair` 需较新版本；mDNS 需服务端 `mdns check` 为 true（Windows 支持有限） |
| 桥 | 同上 + 多路复用 / listen | 比 P1 复杂：至少支持多流，反向隧道模式还要支持监听 |
| 浏览器策略 | 同 P1 | 目标是回环 5037；`wss://localhost` 同样需要可信证书，LNA 一样适用 |
| 互斥约束 | WebUSB 与 ADB server 争抢同一 USB 设备 | adb server 运行时会占用 USB 设备，与现有 WebUSB 模式二选一 |

---

### 7.3 适用场景与优缺点对比

| 维度 | P1（WS 桥 + 5555） | P2（WS 桥 + ADB Server） |
| --- | --- | --- |
| 典型场景 | 内网投屏/调试，设备已用 USB 授权过一次；设备端 Termux 场景（手机浏览器自连） | 需要 Android 11+ 官方无线调试（配对码/QR、动态端口）；已有 ADB 环境的开发机 |
| 前端改动量 | 小：1 个连接实现 + UI 入口，约 200~300 行 | 中：1 个 `ServerConnector` + 配对/发现 UI，约 400~600 行 |
| 桥复杂度 | 低：单条二进制透传 | 高：多流复用，反向隧道还要监听 |
| 是否需装 adb | 否（一次性 `adb tcpip` 可用任意机器完成） | 是，且需常驻 server |
| Android 11+ 无线调试配对 | 不支持 | 支持（委托给 ADB server） |
| 设备发现 | 手工填 IP:端口 | mDNS 自动发现（服务端支持时） |
| 与现有 WebUSB 共存 | 共存（互不影响） | 互斥（ADB server 占用 USB 设备） |
| 性能 | 直连 adbd，路径最短 | 多一跳（浏览器→server→设备），但延迟可忽略 |
| 安全 | 5555 无鉴权，同网段可连 | 无线调试有配对 + TLS，安全性更好 |
| 主要风险 | 依赖 tcpip 常开、重启失效、LNA/混合内容 | 依赖用户环境（platform-tools 版本、server 常驻）、桥复杂、与 USB 模式互斥 |

### 7.4 前置条件

**P1**
1. 设备已用 USB 授权过一次，并成功执行 `adb tcpip 5555`（或 root 设 `service.adb.tcp.port`）
2. 设备与浏览器所在网络互通、同网段，无 AP 隔离
3. 桥已运行且可达；页面 https 时桥必须 `wss://` 且证书受信任
4. Chrome 147+ 环境下确认 LNA 未拦截（必要时策略放行或同地址空间部署）

**P2**
1. 用户机器安装 platform-tools（支持 `adb pair`），且 ADB server 常驻 5037
2. 桥支持多流（反向隧道模式还需支持 listen）
3. 接受与 WebUSB 模式互斥：启用 P2 期间不能走 USB 直连
4. mDNS 可用的服务端（Windows 上支持有限，可能仍需手工填端口）

### 7.5 切换成本

- **P1 → P2**：前端抽象层（`DeviceMeta { serial, connect }`、`Adb` 实例）保持不变，新增的是连接来源；实际增量是 `ServerConnector` 实现 + 桥协议升级（多路复用、可选 listen）+ 配对/发现 UI。若 P1 阶段已把「连接来源」做成可插拔（工厂函数返回 `DeviceMeta`），P2 只加一种来源，不推翻 P1。
- **P2 → P1**：更简单，去掉 `ServerConnector` 与桥的多路复用即可，UI 退化为手填 IP。
- **回到 USB**：两者都不破坏现有 WebUSB 路径，USB 仍是默认且唯一的零依赖入口；P1/P2 只是并列的连接来源。
- **依赖升级风险**：P1 只用到稳定接口（packet 流 + credential store），受上游 v3 变更影响小；P2 依赖 `AdbServerClient`，上游 v3 若调整 server 协议/密钥格式需同步跟进。

## 8. 附：关键结论一句话

上游 webadb **协议栈完全具备无线调试的可行性**（传输无关、认证机制现成、scrcpy 走 ADB 隧道），**不支持的原因是浏览器平台能力缺失**（裸 TCP、TLS 客户端证书、mDNS），而非协议或架构缺陷。因此正确的适配姿势是「补一个传输层 + 必要时加桥」，而不是在前端重写 TLS/配对协议。
