# Dify 工作日报助手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Prodash 中实现从本地待办和用户补充内容生成脱敏日报，并通过轻量 Node 后端调用公司私有化 Dify。

**Architecture:** React 前端新增日报工作流，读取现有 `prodash.todos.v1`，按日期整理任务并展示脱敏预览。Node 原生 HTTP 后端提供 `POST /api/reports/daily`，服务端再次脱敏后调用 Dify Workflow API；Dify 不可用或未配置 API Key 时支持显式 mock 模式。钉钉发送不在本计划内。

**Tech Stack:** React 18、Vite 8、JavaScript、Vitest 4 + React Testing Library、Node.js `node:http`、Dify Workflow API。

## Global Constraints

- 使用 JavaScript，不使用 TypeScript。
- 保持现有 React + Vite 单页应用和 `prodash.todos.v1` 待办存储格式不变。
- 前端不得包含 Dify API Key；Key 只从后端环境变量读取。
- 前端和后端都必须执行脱敏，后端不能信任 `clientSanitized`。
- 未确认脱敏预览时不得发起日报请求。
- 请求失败不得清空补充内容或已生成结果。
- 日报固定包含：今日完成、进行中/未完成、补充工作、问题与风险、明日计划。
- 当前待办模型没有 `completedAt`；第一版按 `createdAt` 的目标日期筛选，再按 `done` 分组，并在界面文案中明确这一口径。
- 不新增钉钉企业应用、机器人或自动发送能力。
- 不把完整日报请求写入日志。
- 所有界面文案使用中文；保持现有深色主题和响应式布局。
- Dify 未配置时只能通过显式 mock 配置运行，不得静默伪装成真实 AI 结果。

---

### Task 1: 日报任务整理与脱敏纯函数

**Files:**
- Create: `src/lib/dailyReport.js`
- Create: `src/lib/dailyReport.test.js`
- Create: `src/lib/sanitize.js`
- Create: `src/lib/sanitize.test.js`

**Interfaces:**
- `buildDailyReportSource(todos, date)` → `{ completedTodos, pendingTodos }`；按本地日期筛选 `createdAt`，已完成任务进入 `completedTodos`，未完成任务进入 `pendingTodos`，每项只保留 `id`、`text`、`important`、`urgent`、`createdAt`。
- `createEmptyExtraWork()` → `{ temporaryWork: '', meetings: '', risks: '', tomorrowPlan: '' }`。
- `sanitizeText(text)` → `{ text, changed, matches }`；替换手机号、邮箱、身份证号和带疑似 token 查询参数的 URL。
- `sanitizeExtraWork(extraWork)` → `{ value, changed, matches }`；按字段调用 `sanitizeText`。
- `sanitizeReportPayload(payload)` → 脱敏 `completedTodos[].text`、`pendingTodos[].text` 和所有 `extraWork` 字段，不修改原对象。

- [ ] **Step 1: 写失败测试**

覆盖：日期筛选、完成状态分组、空补充内容、手机号/邮箱/身份证号/敏感链接替换、嵌套 payload 不变性、普通 URL 不被误替换。

```js
test('只整理指定日期创建的任务并按完成状态分组', () => {
  const result = buildDailyReportSource([
    { id: '1', text: '完成项', done: true, createdAt: '2026-08-05T09:00:00+08:00' },
    { id: '2', text: '未完成项', done: false, createdAt: '2026-08-05T10:00:00+08:00' },
    { id: '3', text: '其他日期', done: true, createdAt: '2026-08-04T10:00:00+08:00' },
  ], '2026-08-05')
  expect(result.completedTodos).toHaveLength(1)
  expect(result.pendingTodos).toHaveLength(1)
  expect(result.completedTodos[0].text).toBe('完成项')
})

test('脱敏常见个人信息但保留普通文本', () => {
  const result = sanitizeText('联系 13812345678 或 a@example.com，编号 110101199001011234')
  expect(result.text).toContain('[手机号]')
  expect(result.text).toContain('[邮箱]')
  expect(result.text).toContain('[身份证号]')
  expect(result.changed).toBe(true)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/lib/dailyReport.test.js src/lib/sanitize.test.js`

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 写最小实现**

使用 `createdAt.slice(0, 10)` 与目标日期比较；不要修改 todo 原对象。脱敏规则使用具名正则常量，手机号、邮箱和身份证号分别替换；URL 仅在 query 参数名包含 `token`、`access_token`、`secret` 或 `key` 时替换整个链接。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/lib/dailyReport.test.js src/lib/sanitize.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/dailyReport.js src/lib/dailyReport.test.js src/lib/sanitize.js src/lib/sanitize.test.js
git commit -m "feat: add daily report data preparation"
```

---

### Task 2: Node 后端 Dify 客户端与日报接口

**Files:**
- Create: `server/difyClient.js`
- Create: `server/difyClient.test.js`
- Create: `server/reportServer.js`
- Create: `server/reportServer.test.js`
- Create: `server/index.js`
- Create: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `createDifyClient({ baseUrl, apiKey, user, fetchImpl, timeoutMs, mock })` → `{ runWorkflow }`。
- `runWorkflow(inputs)` → `Promise<{ report: string, generatedAt: string }>`；真实模式调用 `${baseUrl}/v1/workflows/run`，请求体为 `{ inputs, response_mode: 'blocking', user }`，Header 为 `Authorization: Bearer <key>` 和 JSON Content-Type。
- `createReportServer({ port, difyClient, sanitizePayload })` → Node HTTP server；提供 `POST /api/reports/daily`。
- 成功响应：`200 { report, generatedAt }`。
- 客户端错误：`400 { error: '请求内容无效' }`；Dify/服务错误：`502 { error: '日报生成服务暂时不可用' }`；其他方法或路径：`404`。

- [ ] **Step 1: 写失败测试**

测试 Dify 请求 URL、Header、请求体、超时和 mock 模式；测试接口拒绝非 POST/错误 JSON/超长字段，成功时服务端脱敏并返回统一格式，Dify 失败时不泄露原始错误或 API Key。

```js
test('日报接口服务端再次脱敏并隐藏 Dify 错误', async () => {
  const difyClient = { runWorkflow: vi.fn().mockRejectedValue(new Error('secret-api-key failed')) }
  const server = await startTestServer({ difyClient })
  const response = await postJson(server, '/api/reports/daily', {
    date: '2026-08-05',
    completedTodos: [{ id: '1', text: '联系 13812345678' }],
    pendingTodos: [],
    extraWork: { temporaryWork: '', meetings: '', risks: '', tomorrowPlan: '' },
  })
  expect(response.status).toBe(502)
  expect(response.body.error).not.toContain('secret-api-key')
  expect(difyClient.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
    completed_tasks: expect.stringContaining('[手机号]'),
  }))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- server/difyClient.test.js server/reportServer.test.js`

Expected: FAIL，因为后端模块尚不存在。

- [ ] **Step 3: 写最小实现**

使用 Node 原生 `http`、`URL` 和全局 `fetch`，不引入 Express。请求体限制为 256 KB；读取 JSON 时拒绝非法 JSON。校验 `date` 为 `YYYY-MM-DD`，四个 `extraWork` 字段必须为字符串且每个最多 5000 字符。服务端先调用 `sanitizeReportPayload`，再把任务转换为 JSON 字符串传给 Dify：`report_date`、`completed_tasks`、`pending_tasks`、`extra_work`、`risks`、`tomorrow_plan`。

真实 Dify 模式从 `DIFY_BASE_URL`、`DIFY_API_KEY`、`DIFY_USER`、可选 `DIFY_TIMEOUT_MS` 读取配置。Dify 返回体从 `data.outputs.report` 读取日报正文；若工作流输出使用 `text` 键，则读取 `data.outputs.text`，两者都为空时视为格式错误。`DIFY_MOCK=true` 时返回明确的 `[Mock]` 固定日报，方便无 API Key 开发和测试；未 mock 且缺 Key 时启动检查或首次请求必须报配置错误，不能返回 mock 内容。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- server/difyClient.test.js server/reportServer.test.js`

Expected: PASS。

- [ ] **Step 5: 增加启动脚本与环境样例**

在 `package.json` 增加 `concurrently`（`^9.2.1`）开发依赖和脚本：

```json
"server": "node server/index.js",
"dev:full": "concurrently \"vite\" \"node server/index.js\""
```

同时创建 `server/index.js` 读取环境变量并监听 `REPORT_SERVER_PORT`（默认 `8787`）；不改变现有 `dev`、`test`、`build` 脚本。

`.env.example` 只包含变量名和说明，不包含真实 Key：`DIFY_BASE_URL`、`DIFY_API_KEY`、`DIFY_USER`、`DIFY_TIMEOUT_MS`、`DIFY_MOCK`、`REPORT_SERVER_PORT`。

- [ ] **Step 6: 运行后端测试与构建**

Run: `npm test -- server/difyClient.test.js server/reportServer.test.js && npm run build`

Expected: 后端测试和前端生产构建均 PASS。

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example server/
git commit -m "feat: add daily report api with Dify adapter"
```

---

### Task 3: 前端日报状态与表单

**Files:**
- Create: `src/components/ReportDateSelector.jsx`
- Create: `src/components/ReportSourceSummary.jsx`
- Create: `src/components/ReportExtraInput.jsx`
- Create: `src/components/PrivacyPreview.jsx`
- Create: `src/components/ReportResult.jsx`
- Create: `src/components/ReportView.jsx`
- Create: `src/components/ReportView.test.jsx`

**Interfaces:**
- `ReportDateSelector({ value, onChange })`：输出 `YYYY-MM-DD` 日期字符串。
- `ReportSourceSummary({ source })`：展示完成/未完成数量。
- `ReportExtraInput({ value, onChange })`：受控输入四个补充字段。
- `PrivacyPreview({ payload, onConfirm, onCancel })`：只展示脱敏 payload；确认后调用 `onConfirm()`。
- `ReportResult({ report, onCopy, copied })`：展示日报正文和复制按钮。
- `ReportView()`：读取 `prodash.todos.v1`，组合上述组件，状态包括 `idle`、`preview`、`loading`、`success`、`error`；不保存补充内容到 localStorage。

- [ ] **Step 1: 写失败测试**

覆盖：默认今天、任务数量和日期筛选、四个补充输入、脱敏预览、未确认时不请求、成功展示、失败保留输入、重新生成回到预览、复制成功提示。

```jsx
test('确认脱敏预览后才调用接口并展示日报', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ report: '今日完成\n1. 完成测试', generatedAt: '2026-08-05T18:00:00Z' }),
  }))
  render(<ReportView />)
  await userEvent.setup().type(screen.getByLabelText('临时工作'), '完成接口联调')
  await userEvent.setup().click(screen.getByRole('button', { name: '生成日报' }))
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.getByText('脱敏预览')).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: '确认并生成' }))
  expect(fetch).toHaveBeenCalledWith('/api/reports/daily', expect.objectContaining({ method: 'POST' }))
  expect(await screen.findByText(/完成测试/)).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/components/ReportView.test.jsx`

Expected: FAIL，因为日报组件尚不存在。

- [ ] **Step 3: 写最小实现**

`ReportView` 用 `useLocalStorage('prodash.todos.v1', [])` 读取任务；日期由本地 `Date` 格式化，调用 Task 1 的 `buildDailyReportSource` 和 `sanitizeReportPayload`。点击生成只创建预览，不请求接口。确认后 `fetch('/api/reports/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })`。`response.ok` 为 false 或 JSON 缺少非空 `report` 时进入错误状态。使用 `navigator.clipboard.writeText`，失败时显示“请手动选择并复制”。

所有按钮和输入框添加中文 accessible label；错误使用 `role="alert"`；loading 时禁用确认按钮但不禁用输入内容。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/components/ReportView.test.jsx`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/Report*.jsx src/components/ReportView.test.jsx
git commit -m "feat: add daily report composer"
```

---

### Task 4: 接入 App、Vite 代理与样式

**Files:**
- Modify: `src/App.jsx`
- Modify: `vite.config.js`
- Modify: `src/styles/components.css`
- Modify: `src/styles/theme.css`
- Modify: `src/App.test.jsx`

**Interfaces:**
- App 新增 `{ key: 'report', label: '日报' }` Tab，点击后渲染 `ReportView`，切换回来不丢待办。
- Vite 开发服务器将 `/api` 代理到 `http://localhost:8787`，生产环境通过 `VITE_REPORT_API_BASE_URL` 或同源反向代理提供后端。

- [ ] **Step 1: 写失败测试**

在 `src/App.test.jsx` 增加：默认仍为待办；点击“日报”显示日期选择器和“生成日报”；日报与待办切换后待办数据仍存在。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/App.test.jsx`

Expected: FAIL，因为 App 尚未注册日报 Tab。

- [ ] **Step 3: 接入组件与代理**

在 `TABS` 中加入日报并在内容分支渲染 `ReportView`。Vite `server.proxy['/api']` 指向 `process.env.REPORT_API_TARGET || 'http://localhost:8787'`，保留现有 base 配置和其他测试设置。

- [ ] **Step 4: 增加视觉样式**

为日报表单、字段分组、脱敏预览、结果卡片、loading、错误状态和复制按钮增加样式；桌面端采用单列内容卡片，窄屏下输入框、按钮和预览内容不溢出。保持现有深色主题变量，不改变待办和四象限的既有视觉层级。

- [ ] **Step 5: 运行测试与构建**

Run: `npm test -- src/App.test.jsx src/components/ReportView.test.jsx && npm run build`

Expected: PASS，构建成功。

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/App.test.jsx vite.config.js src/styles/
git commit -m "feat: integrate daily report into app shell"
```

---

### Task 5: README、端到端验收与安全检查

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: 更新使用说明**

说明本地启动方式：`npm run dev` 仅启动前端、`npm run server` 启动后端、`npm run dev:full` 同时启动；说明复制到 `.env` 的配置方式、`DIFY_MOCK=true` 的模拟模式、真实 Dify Key 不得提交；注明钉钉自动发送尚未接入。

- [ ] **Step 2: 加强忽略规则**

在 `.gitignore` 增加 `.env`、`.env.*`，但保留 `.env.example`，并确认现有 `node_modules`、`dist` 规则不变。

- [ ] **Step 3: 运行完整自动化验证**

Run: `npm test && npm run build`

Expected: 现有待办/四象限测试、日报前端测试、后端测试全部 PASS，生产构建成功。

- [ ] **Step 4: 运行 mock 模式手动验收**

设置 `DIFY_MOCK=true` 后运行 `npm run dev:full`，检查：

1. 日报 Tab 可打开，默认日期为今天。
2. 指定日期的已完成/未完成待办数量正确。
3. 四个补充字段可填写。
4. 生成日报先显示脱敏预览，不直接请求。
5. 确认后显示明确的 `[Mock]` 日报。
6. 复制成功或显示手动复制提示。
7. 模拟后端不可用时，输入内容仍保留。
8. 窄屏下页面不横向溢出。

- [ ] **Step 5: 检查敏感信息与状态**

Run: `git status --short; git diff --check; git grep -n "DIFY_API_KEY\|Bearer " -- ':!package-lock.json'`

Expected: 真实 API Key 不在仓库；只有后端读取环境变量的代码和 `.env.example` 变量名出现。确认无意外修改 `npx` 或 `src 1.0.0.zip` 等现有未跟踪文件。

- [ ] **Step 6: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: document daily report setup and validation"
```

---

## Implementation Order

Task 1 → Task 2 → Task 3 → Task 4 → Task 5。

Task 1 和 Task 2 的纯函数/API 契约先稳定；Task 3 依赖前两者；Task 4 才把日报接入现有 App；Task 5 进行最终文档和手动验收。钉钉适配器另立设计与实现计划，不纳入本期。
