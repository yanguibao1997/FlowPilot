# Grok Device Consent 可信点击修复设计

## 背景与根因

Grok OIDC mint 的第 6 步已经能够进入 `https://auth.x.ai/oauth2/device/consent`，但点击“允许”后会跳转到 `https://auth.x.ai/oauth2/device/approve` 并显示 `Invalid action`，token 轮询继续返回 `authorization_pending`。

可工作的参考实现 `cpa_xai/browser_confirm.py` 明确区分两类点击：普通“继续”可使用 JavaScript 点击，consent 页的精确“允许”必须使用浏览器级真实点击。否则 React 表单不会形成有效的 `action=allow` 提交。

当前 FlowPilot 的 `simulateRealClick()` 由内容脚本调用 `dispatchEvent()` 和 `element.click()`。这些事件仍是非可信事件，不能等价于参考实现通过浏览器自动化驱动的真实点击。因此，日志虽然显示 `REAL click`，实际提交仍可能被 x.ai 判定为无效动作。

## 目标

- consent 页只匹配精确文本“允许”、“Allow”、“Authorize”或“Approve”，不得误点“全部允许”等控件。
- 使用 Chrome Debugger `Input.dispatchMouseEvent` 完成浏览器级点击。
- 点击时允许短暂激活 device 标签页。
- token poll 继续作为授权成功的最终事实来源。
- 保留 `Invalid action` 重开 `verification_uri_complete` 的异常恢复能力。

## 非目标

- 不修改 device code 请求和 token poll 协议。
- 不调整 Grok 注册、邮箱验证、SSO 提取或凭据上传步骤。
- 不构造或调用 x.ai 未公开的 consent API。
- 不对其他普通按钮统一改成 Debugger 点击。

## 方案比较

### 方案 A：内容脚本定位，后台 Debugger 点击（采用）

内容脚本精确定位 consent 按钮并返回可序列化坐标；后台复用现有 `clickWithDebugger()` 发出 `mouseMoved`、`mousePressed`、`mouseReleased`。

优点是行为与参考实现的真实点击等价，复用仓库现有能力，不增加权限，改动范围小。代价是点击时会短暂激活标签页，且用户打开该标签页 DevTools 时 Debugger 附加可能失败。

### 方案 B：内容脚本补写 `action=allow` 后提交

继续使用 `element.click()` 或 `requestSubmit()`，并显式写入隐藏字段。实现简单，但仍依赖 x.ai 当前表单结构与非可信事件处理方式，已经存在 `Invalid action` 的实际失败证据。

### 方案 C：直接发送 consent 请求

从页面提取字段并直接请求 approve 接口。该方案依赖 CSRF、Cookie、一次性状态和内部接口约定，维护及安全风险最高，不采用。

## 组件与职责

### `flows/grok/content/device-confirm-page.js`

内容脚本继续负责识别页面阶段和精确查找按钮。进入 consent 阶段并找到允许按钮时，不再调用 `simulateRealClick()`，而是返回：

- `trustedClickRequired: true`
- `clickTarget: 'allow'`
- `clickLabel`: 实际匹配到的精确文本
- `clickRect`: 包含 `centerX`、`centerY` 的可序列化视口坐标
- `pageState: 'consent'`

只有可见、未禁用且矩形有效的按钮才能生成可信点击请求。找不到按钮时仍返回等待状态和按钮预览。

### `background.js`

`runDeviceConfirmInTab` 的短轮询收到 `trustedClickRequired` 后：

1. 校验 `clickTarget` 为 `allow`，且坐标为有限数值。
2. 调用现有 `clickWithDebugger(tabId, clickRect, { visibleStep: 6 })`。
3. Debugger 点击成功后才记录“device 点击允许”。
4. 将本轮视为可能发生导航，等待页面稳定并重新连接内容脚本。

现有 `clickWithDebugger()` 已负责激活标签页、检查 Stop 状态、附加/释放 Debugger，并在异常时释放连接。本次不复制第二套点击实现。

## 数据流

1. 后台申请 device code，打开 `verification_uri_complete`，同时开始 token poll。
2. 内容脚本按短 tick 驱动 device code、登录和跳转页面。
3. consent 页内容脚本返回按钮坐标，不自行提交表单。
4. 后台通过 Debugger 完成可信点击。
5. 页面进入 done，或 token poll 直接取得 token。
6. token poll 成功后按现有流程生成并保存 OIDC 凭据。

## 错误处理

- 按钮不存在或尚未可点击：保持 consent 等待状态，不执行表单兜底提交。
- 坐标无效：抛出明确错误，不尝试非可信点击。
- Debugger 附加失败：沿用现有提示，说明需要关闭该标签页 DevTools 后重试。
- 点击后仍出现 `Invalid action`：重开原始 `verification_uri_complete`，但不增加模拟点击兜底；随后重新定位并再次使用 Debugger。
- 用户停止：`clickWithDebugger()` 在每个阶段检查停止状态，并在 `finally` 中释放 Debugger。
- token poll 成功：继续以 token 为最终成功依据，不要求页面收尾必须先返回 done。

## 测试设计

- 内容脚本测试：consent 分支不再对允许按钮调用 `simulateRealClick()` 或直接提交表单。
- 内容脚本测试：精确允许按钮会产生 `trustedClickRequired`、`clickTarget` 和有效中心坐标。
- 后台测试：收到可信点击请求时调用 `clickWithDebugger()`，参数包含当前 device 标签页和步骤 6。
- 后台测试：Debugger 抛错时不记录点击成功，也不将本轮标记为完成。
- 回归测试：保留 device code、邮箱、密码、Invalid action 恢复、并行 token poll 和 Stop 清理测试。
- 完成前运行定向 Grok 测试和完整 `npm test`。

## 验收标准

- 第 6 步日志在 consent 阶段显示 Debugger 可信点击，而不是内容脚本“REAL click”。
- 正常流程不再因内容脚本点击进入 `Invalid action`。
- token poll 能从 `authorization_pending` 转为成功并完成 OIDC mint。
- Debugger 点击失败时给出可操作错误，不伪报成功。
- 全量自动化测试通过，且不修改用户现有 `.idea/` 文件。
