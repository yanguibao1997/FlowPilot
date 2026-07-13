# Grok CPA / SUB2API 上传链路设计

日期：2026-07-13  
状态：已评审（用户确认方案 3：CPA + SUB2API）  
范围：FlowPilot `flows/grok` 尾链增强；邮件验证码与注册前半段基本不动  
参考：`register_cli.py` / `cpa_xai` / `cpa_export.py` / `cpa_to_sub2api.py`（语义移植，不搬多线程）

## 1. 目标

在 FlowPilot 现有 Grok 注册能力上，补齐注册成功后的可上传产物链路：

1. 注册并拿到 `email` / `password` / `sso` / cookies（1–5 基本复用）
2. 共享 **OIDC mint**，产出 CPA 兼容的 `type: "xai"` auth JSON
3. 按来源上传：
   - **CPA**：写入管理端 auth-files
   - **SUB2API**：创建 `platform: "xai"` 账号

成功标准：

- 侧边栏切到 Grok，来源选 CPA 或 SUB2API
- Auto 可从打开注册页跑到对应平台上传成功
- 邮件验证码路径不改行为
- 不污染 OpenAI 的 OAuth / platform-verify 语义

## 2. 非目标（第一版）

- 不实现 CLI 多线程、TabPool、独立 Chromium mint 进程
- 不改邮件生成 / 验证码轮询核心
- 不复用 OpenAI `confirm-oauth` / `platform-verify` 作为 Grok 尾链
- 不强制本地落盘 `cpa_auths/`（以 runtime 产物 + 直传为主）
- 不做 NSFW、grok2api 本地池
- webchat2api 可保留为可选来源，但不是本设计必交付默认路径

## 3. 现状与差距

### 已有

- 步骤 1–5：打开注册页 → 邮箱 → 验证码 → 资料 → 提 SSO  
  模块：`flows/grok/background/register-runner.js`、content、mail-rules
- 步骤 6 现状：SSO 上传 webchat2api  
  模块：`flows/grok/background/publisher-webchat2api.js`
- 侧栏已有 CPA / SUB2API 配置 UI（主要为 OpenAI 使用）
- CPA 管理接口已有 `auth-files` 导入能力（OpenAI session JSON）
- SUB2API 已有 admin login / groups / create account（OpenAI oauth 路径）

### 缺口

| 能力 | CLI | FlowPilot Grok |
|---|---|---|
| OIDC device-code mint | 有 | 无 |
| `type:xai` auth JSON | 有 | 无 |
| CPA auth-files 上传 xAI | 有 | 无 |
| SUB2API `platform:xai` 创建 | 有导出结构 | 无上传 |
| Grok target = cpa/sub2api | - | 仅 webchat2api |

关键认知：侧栏 CPA/SUB2API **配置可复用**，OpenAI **OAuth 回调步骤不可复用**。

## 4. 目标链路

```text
[1] grok-open-signup-page
[2] grok-submit-email
[3] grok-submit-verification-code   # 邮件逻辑复用
[4] grok-submit-profile             # 必须保留 password
[5] grok-extract-sso-cookie         # 增强 cookie 快照
[6] grok-mint-oidc                  # 新：共享 mint
[7] grok-upload-cpa | grok-upload-sub2api   # 按 target 二选一
```

原则：

- 通用层只负责“怎么跑 flow”
- mint 与上传都是 Grok 私有能力，放在 `flows/grok/*`
- mint 一次，尾链按 `targetId` 分叉

## 5. 方案选择

采用 **扩展内完整链路**：

- 在 content/background 实现 device 确认与 token 轮询
- CPA / SUB2API 用扩展 `fetch` 直传管理端
- 侧栏 Grok 下来源增加 CPA、SUB2API，配置优先复用现有字段

备选未采用：

- 本地 Python helper mint：部署重、体验割裂
- 仅导出 JSON 手动上传：无法 Auto 闭环

## 6. 模块与文件改动

### 新增

| 文件 | 职责 |
|---|---|
| `flows/grok/background/oidc-minter.js` | device code、token 轮询、组装 authJson、编排确认页 |
| `flows/grok/background/publisher-cpa.js` | 上传 xAI auth 到 CPA auth-files |
| `flows/grok/background/publisher-sub2api.js` | 转换并创建 SUB2API xAI 账号 |
| `flows/grok/content/device-confirm-page.js` | device 确认页 DOM 操作 |
| `flows/grok/background/credential-schema.js`（可选） | CPA auth / SUB2API account 转换 |

### 修改

| 文件 | 改动 |
|---|---|
| `flows/grok/index.js` | targets 增加 `cpa`、`sub2api`；capabilities、settingsGroups、driverDefinitions |
| `flows/grok/workflow.js` | 步骤 6 mint；步骤 7 按 target 动态节点 |
| `flows/grok/background/state.js` | mint/upload 运行态、清理规则 |
| `flows/grok/background/register-runner.js` | 步骤 5 增强 cookie 导出（1–4 不改） |
| `background.js` | importScripts + 执行路由挂载 |
| `manifest.json` | content_scripts 覆盖 device 确认相关 host |
| `sidepanel/sidepanel.html` / `sidepanel.js` | Grok 来源切换、状态展示、配置显隐 |
| `tests/*` | schema、publisher、workflow 分叉、日志脱敏 |

### 复用但不污染

- `background/cpa-api.js`：复用 origin/key/`fetchCpaManagementJson`；**新增** xAI auth-files 方法，不走 oauth-callback
- `background/sub2api-api.js`：复用 login/groups/proxy；**新增** createXaiAccount，不走 openai generate-auth-url / exchange-code / codex-session

### 基本不改

- Grok 邮件规则与验证码步骤
- OpenAI workflow / platform-verify / confirm-oauth

## 7. 运行态与配置态

### 7.1 运行态 `runtimeState.flowState.grok`

```js
{
  register: {
    status: 'idle' | 'running' | 'verified' | 'profiled' | 'failed',
    email: '',
    password: '',
    verificationCode: ''
  },
  sso: {
    currentCookie: '',
    cookies: [],
    extractedAt: 0
  },
  mint: {
    status: 'idle' | 'running' | 'authorized' | 'failed',
    userCode: '',
    verificationUri: '',
    deviceCode: '',
    accessToken: '',
    refreshToken: '',
    idToken: '',
    expiresIn: 0,
    expiredAt: '',
    sub: '',
    authJson: null,
    mintedAt: 0,
    message: ''
  },
  upload: {
    status: 'idle' | 'running' | 'uploaded' | 'failed',
    targetId: 'cpa' | 'sub2api',
    targetUrl: '',
    fileName: '',
    accountName: '',
    message: '',
    uploadedAt: 0
  }
}
```

清理：

- 新一轮 Auto / 重置：清空 register、sso、mint、upload 敏感字段
- 步骤 5 成功：清空上一轮 mint/upload，避免串号
- 日志禁止 password / token / sso 全文

### 7.2 配置态

第一版 Grok 直接读取现有侧栏 CPA / SUB2API 配置：

| 来源 | 字段 |
|---|---|
| CPA | `vpsUrl`、`vpsPassword` |
| SUB2API | `sub2apiUrl`、`sub2apiEmail`、`sub2apiPassword`、分组、优先级、代理 |

后续若需隔离，再拆到 `settingsState.flows.grok.targets.*`。

## 8. Mint 设计（步骤 6）

### 8.1 前置条件

- `register.email`、`register.password` 存在
- `sso.currentCookie` 存在（强烈建议同时有 `sso.cookies[]`）

### 8.2 Device OAuth

常量对齐 CLI `cpa_xai/oauth_device.py`：

- `CLIENT_ID = b1a00492-073a-47ea-816f-4c329264a828`
- `DEVICE_CODE_URL = https://auth.x.ai/oauth2/device/code`
- `TOKEN_URL = https://auth.x.ai/oauth2/token`
- `SCOPE = openid profile email offline_access grok-cli:access api:access`

流程：

1. `POST device/code` 拿 `device_code` / `user_code` / `verification_uri_complete`
2. content 打开确认页并完成授权 UI
3. 轮询 `POST token`（`grant_type=urn:ietf:params:oauth:grant-type:device_code`）
4. 组装 `type: "xai"` authJson

### 8.3 确认页 UI（content）

对齐 `browser_confirm.py` 成功路径：

1. 打开 `verification_uri_complete`
2. 注入 SSO cookies 到 `accounts.x.ai` / `auth.x.ai` / `.x.ai` 等
3. 点「继续」
4. 需要时：邮箱登录 → 等 Turnstile → 填密码 → **真实点击**登录
5. consent 页点击精确文本「允许」（真点击，不用 JS 假点）
6. **token 轮询成功**为唯一完成条件

超时默认约 240s；失败可单步重试 mint，不默认重跑注册。

### 8.4 authJson 形状

```json
{
  "type": "xai",
  "auth_kind": "oauth",
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 21600,
  "expired": "ISO-8601",
  "last_refresh": "ISO-8601",
  "email": "...",
  "sub": "...",
  "base_url": "https://cli-chat-proxy.grok.com/v1",
  "token_endpoint": "https://auth.x.ai/oauth2/token",
  "redirect_uri": "http://127.0.0.1:56121/callback",
  "disabled": false,
  "headers": {
    "x-grok-client-version": "0.2.93",
    "x-xai-token-auth": "xai-grok-cli",
    "x-authenticateresponse": "authenticate-response"
  }
}
```

文件名建议：`xai-<email>.json`。

## 9. 上传设计（步骤 7）

### 9.1 CPA

优先 JSON body（对齐现有 `cpa-api.js` session 导入风格）：

```http
POST {cpaOrigin}/v0/management/auth-files?name=xai-<email>.json
Authorization: Bearer <managementKey>
Content-Type: application/json

<body = mint.authJson>
```

- origin/key：侧栏 CPA 配置
- 若目标 CPA 仅支持 multipart file，实现阶段再补 fallback
- 成功写入 `upload.status=uploaded` 与 `fileName`

### 9.2 SUB2API

1. admin login（复用）
2. 解析 group / proxy / priority（复用）
3. authJson 转账号体（对齐 `cpa_to_sub2api.py`）：

```json
{
  "name": "<email>",
  "platform": "xai",
  "type": "oauth",
  "auto_pause_on_expired": true,
  "expires_at": 0,
  "concurrency": 10,
  "priority": 1,
  "group_ids": [],
  "credentials": {
    "access_token": "...",
    "refresh_token": "...",
    "id_token": "",
    "token_type": "Bearer",
    "expires_in": 21600,
    "expired": "ISO-8601",
    "email": "...",
    "sub": "...",
    "base_url": "https://cli-chat-proxy.grok.com/v1",
    "token_endpoint": "https://auth.x.ai/oauth2/token",
    "redirect_uri": "http://127.0.0.1:56121/callback",
    "headers": {}
  },
  "extra": {
    "email": "...",
    "auth_provider": "xai",
    "source": "flowpilot-grok"
  }
}
```

4. `POST /api/v1/admin/accounts`
5. **禁止**调用 OpenAI 专用路径：`generate-auth-url` / `exchange-code` / `import/codex-session`

## 10. Workflow / 侧栏行为

### 10.1 target 与节点

| targetId | 步骤 7 节点 | 配置区 |
|---|---|---|
| `cpa` | `grok-upload-cpa` | 显示 CPA 地址/密钥 + mint/上传状态 |
| `sub2api` | `grok-upload-sub2api` | 显示 SUB2API 配置 + mint/上传状态 |

`getModeStepDefinitions` / workflow engine 按当前 target 动态返回节点列表。

### 10.2 Auto

- 启动前校验当前 target 必填配置
- 一轮成功 = 步骤 7 上传成功
- mint 成功但上传失败：保留 `mint.authJson`，允许只重试步骤 7
- 账号运行记录：失败节点写实际 nodeId（mint 或 upload）

## 11. 错误分层

| 层 | 示例 | 处理 |
|---|---|---|
| 配置 | 缺 CPA 密钥 / SUB2API 登录 | Auto 前或步骤 7 前失败提示 |
| 注册 1–5 | 验证码超时 | 现有逻辑；邮件不改 |
| mint | Turnstile、登录失败、device 过期 | 步骤 6 failed；可重试 mint |
| 上传 | 401、不支持 xai、分组缺失 | 步骤 7 failed；保留 mint 产物 |
| 停止 | 用户 Stop | 中断轮询与页面等待 |

## 12. 测试计划

最小测试集：

1. `credential-schema`：CPA authJson / SUB2API account 转换
2. `oidc-minter`：device 请求参数与 authJson 组装（mock fetch）
3. `publisher-cpa`：auth-files URL、query name、JSON body
4. `publisher-sub2api`：`platform=xai` payload；不走 openai 路径
5. `workflow`：cpa / sub2api 尾链节点不同
6. 日志脱敏：不含 password / token / sso 全文
7. 步骤 5 cookie 导出结构可被 mint 注入逻辑消费

## 13. 实现顺序建议

1. credential schema + 单测
2. workflow / index targets 分叉（先 mock mint/upload）
3. oidc-minter API 层 + state
4. device-confirm content + mint 编排
5. publisher-cpa / publisher-sub2api
6. sidepanel 来源与状态
7. background 接线 + 集成测试
8. 真机跑通 CPA 与 SUB2API 各一条

## 14. 风险

1. **Turnstile / 风控**：device 确认页可能比注册页更敏感；需真点击与 cookie 注入优先策略
2. **CPA auth-files 兼容性**：不同 CPA 版本可能要求 multipart 或字段差异，需上传失败可观测
3. **SUB2API 是否已支持 platform=xai**：若目标实例过旧，创建会失败；错误信息需明确
4. **密码保留**：mint 需要 password，扩展存储需注意清理与不落日志
5. **manifest host 覆盖**：`auth.x.ai` / device 相关域名需准确，避免 content 注入失败

## 15. 验收清单

- [ ] Grok + CPA：Auto 注册到 auth-files 上传成功
- [ ] Grok + SUB2API：Auto 注册到 xAI 账号创建成功
- [ ] 邮件验证码行为与改前一致
- [ ] OpenAI flow 回归：CPA/SUB2API OAuth 链路不受影响
- [ ] 失败重试：mint 失败可重跑 6；上传失败可重跑 7 且不丢 mint 产物
- [ ] 日志与账号记录无敏感明文泄漏

## 16. 决议记录

- 用户选择：**3 = CPA + SUB2API 都做**
- 邮件验证码：基本不改
- 架构：Grok 私有 mint + publisher；侧栏配置复用
- 下一步：用户确认本 spec 后，再写 implementation plan
