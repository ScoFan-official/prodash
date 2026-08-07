# 钉钉待办同步设计文档

- 日期：2026-08-07
- 状态：已获用户逐节确认
- 项目：Prodash
- 前置文档：[2026-08-05-dify-daily-report-design.md](./2026-08-05-dify-daily-report-design.md)、[2026-08-06-Prodash-v1.0.0决策清单.md](../../2026-08-06-Prodash-v1.0.0决策清单.md)

## 1. 背景与目标

Prodash v1.0.0 已实现「DB 为主」的四象限待办、双轨计时、Dify 自动日报与钉钉知识库发布。用户在调研中发现钉钉内置「待办」功能完整可用（实测 `dws todo` 全命令族），且定位为**领导分发任务的载体**。目标是打通钉钉待办与 prodash：

- 钉钉中「指派给我执行」的待办自动同步进 prodash，**强制归入「重要·紧急」象限**，并备注来源领导（创建人）
- 计时留在 prodash 本地（钉钉侧无计时概念，不做同步）
- 完成状态**双向**同步：prodash 勾选完成即时回写钉钉；钉钉侧标记完成由轮询带回
- 充分复用钉钉侧优势：提醒 / 截止时间 / 循环 / 多端同步

> 用户定位：待办不是最重要的，**自动日报才是硬需求**。本集成让「今日待办数据」更完整（领导任务也进日报），同时不牺牲 prodash 的计时与日报能力。

## 2. 调研结论（实测）

| 事实 | 结论 |
|---|---|
| dws `todo` 命令族 | 创建/查询/详情/修改/完成/删除/子任务/评论/附件/提醒/标签/执行人全可用 |
| 集成通道 | 与现有 `DwsCliPublisher` 同源：宿主 `node.exe + dws.js` 经 `execFile` 调用，`.env` 的 `DWS_BIN`/`DWS_SCRIPT` 直接复用 |
| 来源领导字段 | 详情 `creatorInfo.name` 可取（实测样例「闫佳琪」）；列表不返回，需对**新任务**调 `task get` |
| 完成时间 | 钉钉 `finishTime` 为 `0`，**不可靠** → 「今日完成」口径只能依赖 prodash 本地 `completed_at` |
| 系统生成待办 | 存在考勤等系统任务（`bizTag: certify_todo`），用户选择「所有指派任务」口径后一并导入 |
| 组织隔离 | 本机有 2 个 profile（亿维融智 / ai日报应用测试），待办按组织隔离，需配置来源组织 |

## 3. 范围

### 本期包含

- 后端新增 `server/todoSync/` 模块：`DwsTodoClient` + `TodoSyncService` + 同步路由
- `tasks` 表扩展同步字段（单表方案）
- 拉取：页面加载 + 手动按钮 + 后端每 30 分钟轮询（复用 `server/scheduler.js`）
- 回写：prodash 勾选完成即时调 `dws todo task done`，失败入待重试队列
- 前端：同步按钮 + 来源领导徽标 + 截止时间展示 + 钉钉任务删除禁用 + 四象限锁定
- 日报：钉钉任务并入「今日完成 / 进行中」数据源（口径见 §6）

### 本期不包含

- 双向任务创建（个人任务不上钉钉）
- 钉钉侧计时同步（无此概念）
- 从 prodash 删除钉钉任务并回写钉钉（钉钉任务在 prodash 不可删除）
- 跨日完成时间从钉钉回填（钉钉无可靠完成时间）
- 循环任务的实例展开（按钉钉返回的每条任务原样导入）

## 4. 系统架构

```text
钉钉待办（dws todo，来源组织由 .env 配置）
        ↓ execFile(node.exe, dws.js, args)
Node 后端（server/todoSync/）
    ├── DwsTodoClient      读：todo +get-my-tasks --role-types executor；写：todo task done
    ├── TodoSyncService    upsert 入库 + 强制四象限 + 完成状态回写 + 钉钉侧删除软删本地
    └── routes             POST /api/todo-sync（手动触发）、GET /api/todo-sync（同步状态）
            ↑ 调度：server/scheduler.js 每 30 分钟轮询
MySQL tasks 表（新增 5 列）
    └── 前端照常读 /api/tasks；日报照常走 /api/reports
```

## 5. 数据模型（tasks 表扩展）

```sql
ALTER TABLE tasks
  ADD COLUMN dingtalk_task_id VARCHAR(64) NULL UNIQUE,   -- 钉钉 taskId；本地任务为 NULL
  ADD COLUMN source ENUM('local','dingtalk') NOT NULL DEFAULT 'local',
  ADD COLUMN source_leader VARCHAR(100) NULL,            -- creatorInfo.name（来源领导）
  ADD COLUMN due_time DATETIME(3) NULL,                  -- 钉钉截止时间（仅展示）
  ADD COLUMN sync_writeback ENUM('none','pending') NOT NULL DEFAULT 'none';
```

约束规则：

- 导入时**强制** `important=1, urgent=1`（锁定「重要·紧急」象限）；每次同步**重置**这两个字段，防误改
- `completed_at` 只由**本地勾选时刻**写入；钉钉侧完成状态只同步 `status`，不写 `completed_at`
- **删除规则**：钉钉来源任务在 prodash **不可删除**（前端按钮禁用 + 后端 `DELETE /api/tasks/:id` 拒绝，双保险）；钉钉侧任务消失由同步软删本地副本（`status='deleted'`），不调钉钉删除接口
- 软删除本地任务保留 `source_leader` 等元数据

## 6. 同步机制与数据流

### 6.1 拉取（upsert）

触发：页面加载 + 手动「同步」按钮（POST `/api/todo-sync`）+ 后端每 30 分钟轮询。

流程：

1. `todo +get-my-tasks --role-types executor`，**未完成 / 已完成各拉一次**，分页直至取完
2. 逐条按 `dingtalk_task_id` upsert：
   - **新任务**：插入，强制 `important=1, urgent=1`，`source='dingtalk'`；调 `task get` 取 `creatorInfo.name` 填 `source_leader`（失败则留空，不阻塞）
   - **已存在**：更新 `subject` / `due_time` / 完成状态；每次同步重置 `important/urgent=1`
3. 钉钉侧两轮查询均消失 → 软删本地副本

### 6.2 回写（即时）

- prodash 勾选完成钉钉来源任务 → `PATCH /api/tasks/:id`（`status=completed`）→ 后端即时调 `dws todo task done --task-id <id> --status true`
- 失败 → `sync_writeback='pending'`，下次轮询重试；成功后清除标记
- **反向**：钉钉侧被标记完成 → 轮询发现 → 本地标记 `status='completed'`，但 **不写** `completed_at`（维持日报口径）

### 6.3 来源组织

- 新增 `.env` 变量 `DINGTALK_TODO_PROFILE`（`corpId:userId` 格式）
- **必须显式配置**：当前 dws 默认 profile 是测试组织（ai日报应用测试），不是工作组织；`.env.example` 默认值为工作组织（亿维融智 `ding4108cf4d27f89345acaaa37764f94726:17857219403578277`）
- 未配置时沿用 dws 当前默认 profile，并在同步日志中输出醒目告警提示「待办来源为默认 profile，可能非工作组织」；多账号无默认 profile 时同步启动 fail-fast 报错

## 7. 日报口径（今日完成）

1. 钉钉同步任务参与日报数据源：当日完成（本地 `completed_at`）+ 进行中任务均计入，Dify 变量中附带 `source` / `source_leader`
2. 「今日完成」仅认本地 `completed_at`（用户在本机勾选时刻）；钉钉侧完成的同步任务显示为已完成，但**不计入今日完成统计**
3. `time_summary` 等计时维度不受影响（计时只在本地）

## 8. 前端改动

| 位置 | 改动 |
|---|---|
| `TodoItem.jsx` / `QuadrantCell.jsx` | 钉钉来源任务：删除按钮禁用 + 来源领导徽标（如「来自 闫佳琪」）+ 截止时间展示 |
| `TodoView.jsx` | 顶部「同步钉钉待办」按钮 + 上次同步时间；同步中 loading 态；失败提示不阻塞本地使用 |
| `QuadrantView.jsx` | 钉钉任务固定显示「重要·紧急」格 |
| 日报 `ReportSourceSummary` | 展示「钉钉任务 N 条」来源统计（可选） |

## 9. API 契约

### POST /api/todo-sync

手动触发一次同步（拉取 + 待重试回写补写）。

```json
// 200
{
  "syncedAt": "2026-08-07T12:00:00+08:00",
  "imported": 3,
  "updated": 5,
  "softDeleted": 1,
  "writeback": { "retried": 2, "pending": 0 }
}
```

### GET /api/todo-sync

返回上次同步状态：`{ syncedAt, lastResult, profile }`。

### 受影响已有接口

- `DELETE /api/tasks/:id`：对 `source='dingtalk'` 返回 `403 { error: '钉钉同步任务不可删除' }`
- `PATCH /api/tasks/:id`：钉钉来源任务完成时触发回写；`important/urgent` 修改被忽略（服务端强制重置为 1）

## 10. 错误处理

| 情况 | 处理 |
|---|---|
| dws token 失效 | 同步失败 → 返回错误 + 保留上次同步时间；前端提示「钉钉同步失败，请稍后重试」，不阻塞本地任务使用 |
| 单任务 `task get` 失败 | 跳过该任务 `source_leader`（留空），不影响其余任务导入 |
| 回写失败 | `sync_writeback='pending'` + 下次轮询重试；前端勾选完成即时生效（本地乐观） |
| 钉钉侧无任务 | 返回空增量，不报错 |
| 多组织无默认账号 | 同步启动 fail-fast 报错，提示配置 `DINGTALK_TODO_PROFILE` |
| 调度与同步并发 | 轮询与手动触发互斥（in-flight 标记），避免并发 upsert 竞争 |

## 11. 测试与验收

### 后端单元测试

- `DwsTodoClient`：execFile mock 分页解析、`+get-my-tasks` 输出解析、`task done` 参数组装、超时/非 JSON 输出处理
- `TodoSyncService`：upsert 判重、强制四象限、来源领导提取、钉钉侧消失软删、完成状态双向同步
- 回写：PATCH 完成触发 `task done`、失败置 `pending`、重试清标记

### 后端路由测试

- `POST /api/todo-sync`：成功 / 空 / token 失效
- `DELETE` 拒绝钉钉来源任务（403）
- `PATCH` 钉钉任务 `important/urgent` 强制重置

### 前端测试

- 钉钉任务删除按钮禁用、来源徽标渲染、截止时间展示
- 同步按钮 loading、成功/失败提示、上次同步时间显示
- 四象限视图中钉钉任务锁定在「重要·紧急」

### 手动验收

1. 笔记本启动全链路，配置 `DINGTALK_TODO_PROFILE`（或默认工作组织）
2. 钉钉侧创建一条指派给本人（齐浩南）的待办 → 页面加载/点同步 → prodash 出现该任务，锁定「重要·紧急」，徽标显示来源领导
3. prodash 勾选完成 → 钉钉侧该待办变为已完成
4. 钉钉侧标记另一任务完成 → 轮询后 prodash 显示已完成但不计入当日完成
5. 钉钉侧删除任务 → 轮询后 prodash 软删该任务
6. prodash 中钉钉任务无删除按钮；直接调 DELETE 返回 403

## 12. 配置与预配

`.env` 新增：

```
DINGTALK_TODO_PROFILE=ding4108cf4d27f89345acaaa37764f94726:17857219403578277
DINGTALK_TODO_SYNC_CRON=*/30 * * * *
```

- `DINGTALK_TODO_PROFILE`：来源组织 profile（`corpId:userId` 格式）；**必须显式配置**，未配置则沿用 dws 默认 profile 并告警
- `DINGTALK_TODO_SYNC_CRON`：拉取轮询 cron，默认每 30 分钟（复用现有 cron 基建）

## 13. 生产化线索

| # | 线索 | 位置 | 生产化动作 |
|---|---|---|---|
| ① | 完成时间缺失 | 钉钉 `finishTime=0` | 企业应用 OpenAPI 侧核实完成时刻，或保持本地口径 |
| ② | 回写重试队列 | `sync_writeback` | 加重试退避与告警 |
| ③ | 组织配置 | `DINGTALK_TODO_PROFILE` | 多账号选择策略收敛到统一配置面 |
| ④ | 同步互斥 | in-flight 标记 | 生产化换分布式锁/队列 |
