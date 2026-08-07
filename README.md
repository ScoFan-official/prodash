# 个人效率工作台（Prodash）

深色主题的个人效率工作台，**DB 为主架构 + 自动日报 + 钉钉知识库发布**（demo 原型，v1.0.0）。

将待办、时间管理、日报生成集中在一个工作台：待办（列表 + 艾森豪威尔四象限双视图）、双轨任务计时（人工工时 / Agent 运行时长）、Dify 自动生成日报并发布到钉钉知识库「日报」板块。

- 当前版本：v1.0.0

## 架构

```
浏览器 H5（Node 后端同域托管，无 CORS）
    ↓ HTTP API（无登录，单用户 demo）
Node 后端（Express，:8787，宿主运行）
    ├── MySQL（Docker 容器 + 数据卷，schema 自动初始化）  ← 数据源 of truth
    ├── Dify Workflow API（远程私有化）                   ← 只产出日报文本
    └── 发布器接口 publishReport(...)（接口抽象）
            ├── mock（默认，仅打日志）
            ├── file（写入 REPORTS_OUTPUT_DIR）
            └── dws（DwsCliPublisher，宿主 dws CLI，个人 token）
                    ↓
        钉钉知识库「日报」板块（doc create / update 覆盖，一天一文档）
```

要点：

- **DB 为主**：待办 / 计时 / 日报全部以 MySQL 为准，前端直连 API 读写；localStorage 已废弃并清零（存量数据不迁移，demo 从新开始）。
- **Dify 只产出文本**：后端调用 Dify Workflow API 生成日报正文；`DIFY_MOCK=true` 时返回带 `[Mock]` 标记的固定日报，便于全链路演示。
- **发布器接口抽象**：统一签名 `publish({ date, title, content, existingNodeId }) → { nodeId, url }`，按 `PUBLISHER` 环境变量切换 mock / file / dws 三实现。

## 功能特性

- **工作台外壳**：标题栏 + 顶部 Tab（待办 / 笔记 / Token流水）
- **四象限待办**：添加任务时用「重要？」「紧急？」两个开关，自动归入四个象限
  - 重要·紧急 → 立即做；重要·不紧急 → 计划做；不重要·紧急 → 快速处理；不重要·不紧急 → 尽量少做
- **三视图切换**：列表 / 四象限 / 统计三种查看方式，切换不丢数据
- **双轨任务计时**：每条待办拥有「人工工时」与「Agent 运行时长」两条独立轨道，可并行运行、无全局上限；事件级明细（`start / pause / resume / stop`）落库，可回放任意区间统计
- **计时恢复**：基于后端事件记录与运行中会话恢复，刷新、重开浏览器后恢复运行状态
- **顶部状态条**：待办页顶部显示正在计时的任务，点击展开查看全部轨道与时长详情
- **统计视图**：今日工时汇总、人工 / Agent 时长与占比、按任务排行、按任务分类占比（使用现有 CSS/SVG，无新增图表依赖）
- **自动日报**：Dify 按当天待办数据生成日报正文，定时（默认 21:00）或手动触发；生成后自动发布到钉钉知识库，支持补发与补充内容自动重生成
- **日报历史**：按日查看日报内容、状态与知识库文档链接（doc_url）
- **错误兜底**：读写失败不崩溃，页面给出友好提示
- **响应式**：深色主题，手机窄屏自动适配

## 快速开始（本地演示）

**前置**：Node 24+、Docker。

```bash
# 1. 启动 MySQL（schema 由 docker-entrypoint 自动初始化）
docker compose up -d

# 2. 安装依赖
npm install

# 3. 配置环境变量（全链路 mock 演示：DIFY_MOCK=true、PUBLISHER=mock）
cp .env.example .env
# .env.example 默认即 DIFY_MOCK=true、PUBLISHER=mock，无需改动即可演示

# 4. 启动后端（:8787，托管前端 H5，同域无 CORS）
npm run server

# 5. 开发模式（vite 开发服务器，/api 代理到 :8787，见 vite.config.js）
npm run dev
```

真实形态（真实 Dify + 钉钉发布）：先按 [docs/provisioning/钉钉知识库初始化.md](./docs/provisioning/钉钉知识库初始化.md) 完成一次性预配，再设置 `DIFY_MOCK=false`、`PUBLISHER=dws` 及相关环境变量。

## 环境变量

复制 `.env.example` 为 `.env`（已被 .gitignore 忽略，凭据不提交）。

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `PORT` | 后端监听端口 | `8787` |
| `DB_HOST` / `DB_PORT` | MySQL 地址 / 端口（与 docker-compose.yml 一致） | `127.0.0.1` / `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL 账号 / 密码 / 库名 | `prodash` / `prodash` / `prodash` |
| `DIFY_BASE_URL` | Dify 根地址（代码自动拼接 `/v1/workflows/run`） | 空 |
| `DIFY_API_KEY` | Dify 应用 API Key（后端代持，不落前端） | 空 |
| `DIFY_USER` | Dify 调用用户标识 | `prodash` |
| `DIFY_TIMEOUT_MS` | Dify 请求超时（毫秒） | `30000` |
| `DIFY_MOCK` | `true`/`1` 时返回 `[Mock]` 固定日报，不调真实 Dify | `true` |
| `PUBLISHER` | 发布器实现：`mock` / `file` / `dws` | `mock` |
| `DINGTALK_WIKI_WS_ID` | 钉钉知识库空间 ID（`PUBLISHER=dws` 必需） | 空 |
| `DINGTALK_WIKI_FOLDER_ID` | 钉钉知识库「日报」文件夹 ID（可选） | 空 |
| `DWS_BIN` | dws 可执行文件路径（Windows shim 场景填 node.exe 绝对路径） | `dws` |
| `DWS_SCRIPT` | dws CLI 的 JS 入口绝对路径；设置后发布器按 `DWS_BIN DWS_SCRIPT <args>` 调用（Windows `.cmd`/`.bat` shim 分发导致 execFile ENOENT 时必配） | 空 |
| `REPORTS_OUTPUT_DIR` | `PUBLISHER=file` 时的输出目录 | `reports-output/` |
| `REPORT_CRON` | 日报自动生成 cron（每天 21:00） | `0 21 * * *` |

## API 摘要

- `/api/tasks`：`GET` 列表 / `POST` 新建；`PATCH /api/tasks/:id` 更新（含完成、软删除）；`DELETE /api/tasks/:id` 软删除
- `/api/time-events`：`POST` 追加事件级计时（`{ taskId, track: human\|agent, event: start\|pause\|resume\|stop, ts }`）；`GET /records?date=` 按日明细、`GET /active` 运行中会话、`GET /summary?date=` 当日双轨总时长
- `/api/reports`：
  - `GET /source?date=&includeDeleted=`：日报数据源（待办 + 当日时长）
  - `POST /generate`：生成日报（`{ date, extraWork?, includeDeleted? }`）→ Dify 产出文本 → 自动发布
  - `POST /:date/publish`：补发 / 重试
  - `PUT /:date/extra`：保存补充内容，当天已有日报则自动重生成并覆盖
  - `GET /`：历史列表；`GET /?date=`：单日日报与补充内容

## Dify 工作流变量契约

后端生成日报时，把数据组装成 **7 个输入变量**调用 Dify Workflow API（`/v1/workflows/run`）。用 dify-agent 创建 / 更新「日报助手」工作流应用时，**开始节点必须按本契约配置这 7 个输入变量（全部 string 类型）**，**结束节点输出变量配置为 `report`**。

字段名与代码 `server/services/reportService.js` 的 `buildDifyInputs` 完全一致；若修改代码，请同步更新本表。

| 变量名 | 类型 | 说明 | 示例（序列化前的值） |
|--------|------|------|----------------------|
| `report_date` | string | 日报归属日，`YYYY-MM-DD` | `2026-08-06` |
| `completed_tasks` | string | JSON 数组字符串：当日完成的任务（见下方数组项字段） | `[{"id":1,"title":"写周报","important":true,"urgent":false,"humanMs":2400000,"agentMs":1800000,"humanTime":"40 分钟","agentTime":"30 分钟","totalTime":"1 小时 10 分钟"}]` |
| `pending_tasks` | string | JSON 数组字符串：当天新建且仍在进行中的任务（结构同上） | `[{"id":2,"title":"联调接口","important":false,"urgent":true,"humanMs":900000,"agentMs":5400000,"humanTime":"15 分钟","agentTime":"1 小时 30 分钟","totalTime":"1 小时 45 分钟"}]` |
| `extra_work` | string | JSON 对象字符串：补充内容 | `{"temporaryWork":"临时会议","meetings":"产品评审"}` |
| `risks` | string | 问题与风险（纯文本） | `暂无` |
| `tomorrow_plan` | string | 明日计划（纯文本） | `开始 v1.1.0 开发` |
| `time_summary` | string | JSON 对象字符串：当日双轨总时长（毫秒 + 预格式化文本） | `{"totalHumanMs":3600000,"totalAgentMs":5400000,"totalHumanTime":"1 小时","totalAgentTime":"1 小时 30 分钟"}` |

`completed_tasks` / `pending_tasks` 数组项字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 任务 ID |
| `title` | string | 任务标题（软删除任务为「已删除任务」或原名） |
| `important` / `urgent` | boolean | 艾森豪威尔四象限标记 |
| `humanMs` | number | 该任务当日人工工时（毫秒，原始值） |
| `agentMs` | number | 该任务当日 Agent 运行时长（毫秒，原始值） |
| `humanTime` | string | 该任务当日人工工时（预格式化可读文本，如 `40 分钟`；服务端由 `humanMs` 格式化，**LLM 应直接引用**，勿自行换算毫秒） |
| `agentTime` | string | 该任务当日 Agent 运行时长（预格式化可读文本，如 `1 小时 30 分钟`；服务端由 `agentMs` 格式化，同上） |
| `totalTime` | string | 该任务人工 + Agent **合计用时**（预格式化可读文本，如 `1 小时 10 分钟`；服务端由 `humanMs + agentMs` 格式化，**LLM 标注用时优先引用此单值**，避免在双轨间挑选出错） |

> 用时字段由服务端预格式化（`formatDuration`，输出 `X 小时` / `X 分钟` / `X 小时 X 分钟` / `不足 1 分钟`），LLM 直接引用文本即可，无需自行换算毫秒值。

实际请求中数组 / 对象字段以 `JSON.stringify` 序列化为字符串后发送。完整请求示例（`inputs` 字段）：

```json
{
  "report_date": "2026-08-06",
  "completed_tasks": "[{\"id\":1,\"title\":\"写周报\",\"important\":true,\"urgent\":false,\"humanMs\":2400000,\"agentMs\":1800000,\"humanTime\":\"40 分钟\",\"agentTime\":\"30 分钟\",\"totalTime\":\"1 小时 10 分钟\"}]",
  "pending_tasks": "[{\"id\":2,\"title\":\"联调接口\",\"important\":false,\"urgent\":true,\"humanMs\":900000,\"agentMs\":5400000,\"humanTime\":\"15 分钟\",\"agentTime\":\"1 小时 30 分钟\",\"totalTime\":\"1 小时 45 分钟\"}]",
  "extra_work": "{\"temporaryWork\":\"临时会议\",\"meetings\":\"产品评审\"}",
  "risks": "暂无",
  "tomorrow_plan": "开始 v1.1.0 开发",
  "time_summary": "{\"totalHumanMs\":3600000,\"totalAgentMs\":5400000,\"totalHumanTime\":\"1 小时\",\"totalAgentTime\":\"1 小时 30 分钟\"}"
}
```

**输出契约**：结束节点输出变量 `report`（string，日报正文）。后端从 `data.outputs.report` 读取（兜底兼容 `data.outputs.text`）。

## 日报口径（重要）

1. **「今日完成」**：`completedAt ∈ [服务器本地当天 00:00, 次日 00:00)`，按完成时刻归属当天；日界取**服务器本地时区**（非 UTC 墙钟），中国时区下本地 00:30 完成的任务不会被算到前一天。
2. **运行中 / 跨日会话**：计时时长按**生成时刻（asOf）截断**计入，不虚增到窗口末尾（最多到午夜）；完整跨日切分留待后续版本。
3. **前端计时事件为 best-effort 同步**：网络失败时该段时长以浏览器 `pagehide` 刷出为准；极端失败会丢失该段时长（demo 阶段接受）。
4. **自动调度**：`REPORT_CRON`（默认每天 21:00）触发自动生成；当天已有 `published` 状态日报则**跳过**。用户当天补充内容保存后，自动**重新生成并覆盖**当天文档（一天一个固定 nodeId，`doc update` 覆盖，不新建）。

## 测试与构建

```bash
npm test           # Vitest 全量测试
npm run build      # 生产构建（输出到 dist/，由后端同域托管）
```

## 版本管理

项目使用 **SemVer（语义化版本）**，格式为 `主版本.次版本.修订号`：

| 更新类型 | 场景 | 版本号变化 | 命令 |
|---------|------|-----------|------|
| 主版本（MAJOR） | 破坏性变更，不兼容旧版 | 1.x.x → 2.0.0 | `npm version major` |
| 次版本（MINOR） | 新增功能，向后兼容 | 1.0.x → 1.1.0 | `npm version minor` |
| 修订号（PATCH） | Bug 修复，向后兼容 | 1.0.0 → 1.0.1 | `npm version patch` |

发版流程：`npm version minor` 升级版本号并打 `v1.1.0` 标签 → `git push origin main --tags` 推送代码与标签。每次发版在下方「版本历史」追加一条记录。

### 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.1.3 | 2026-08-07 | UI 全面升级：引入 Radix headless primitives + Lucide 图标 + 四层 CSS 设计系统（tokens/base/primitives/components）；重构 App 导航为 `<nav>` + 禁用态占位 Tab；TodoItem 改为两行结构（标题行 + 双轨计时行）；待办页引入 SegmentedControl、Banner、Skeleton 组件；四象限视图使用 Card + EmptyState + token 配色；TimeStatsView 的 SVG donut 迁移至 token 颜色 + Card 包裹；日报页原生 select/table 替换为 Radix Select + Badge + styled table；响应式新增 640/768/1024px 断点；统一焦点环与 `prefers-reduced-motion` 支持；清理 legacy CSS，删除 PlaceholderView 与 theme.css；307/307 测试通过 |
| v1.0.0 | 2026-08-06 | 架构升级：DB 为主（MySQL Docker + schema 自动初始化），localStorage 废弃清零；Node 后端（Express :8787）托管前端 H5，GitHub Pages 部署退役；事件级计时（time_events：start/pause/resume/stop）；Dify Workflow 自动生成日报（DIFY_MOCK 可全链路 mock）；发布器抽象（mock/file/dws），dws 发布到钉钉知识库「日报」板块；日报调度（REPORT_CRON 默认 21:00）+ 补充内容自动重生成 + 补发；.env 环境变量分离 |
| v0.2.1 | 2026-08-06 | UI 调整：四象限改为经典艾森豪威尔布局（重要·紧急在右上角）、任务卡片视觉层次优化（重要·紧急更突出）、计时控件布局调整、统计视图新增象限分布与 Agent 效率两个维度；顶部 Tab「记账」更名「Token流水」（功能待后续版本开发） |
| v0.2.0 | 2026-08-05 | 双轨任务计时（人工 / Agent 可并行）、计时持久化与恢复、顶部状态条、今日统计视图、日报导出预留接口；移除「番茄钟」Tab，计时嵌入待办页 |
| v0.1.0 | 2026-08-05 | 首个版本：工作台外壳 + 四象限待办（双视图、持久化、深色响应式）、GitHub Pages 部署 |

> 注：v0.2.1 该版部署方式（GitHub Pages）已退役，v1.0.0 起前端由后端同域托管。

## 未来规划

1. **钉钉群应用 H5 + 免登（v1.x）**：群应用嵌入、钉钉免登、可信域名托管（决策清单 §十一）
2. **企业应用权限 + 发布器换 `DingTalkAppPublisher`**：以企业应用 OpenAPI 替换 dws，消除个人 token 生命周期问题（决策清单 §十 ①）
3. **后端上公司服务器**：系统级 cron + 监控告警，替代笔记本宿主运行（决策清单 §十一）
4. **跨日切分完善**：完整跨日会话切分、周/月时长趋势（基于 time_events 直接可算，决策清单 §十 ②）
5. **Token流水**：升级「Token流水」Tab，跟踪 AI/Agent 使用产生的 Token 消耗与费用
6. **日报发布可靠性生产化**：自动重试 / 补发基座（决策清单 §十 ③）
