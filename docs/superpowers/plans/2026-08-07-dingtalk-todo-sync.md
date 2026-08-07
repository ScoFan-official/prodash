# 钉钉待办同步 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通钉钉待办与 Prodash：钉钉「指派给我执行」的待办自动同步进四象限「重要·紧急」格并备注来源领导，完成状态双向同步（本地勾选即时回写钉钉、钉钉侧完成由轮询带回），钉钉任务锁定（标题/四象限/删除）且不牺牲计时与日报能力。

**Architecture:** 后端新增 `server/todoSync/` 模块：`DwsTodoClient` 复用现有 `DwsCliPublisher` 的 `execFile(node.exe, dws.js, args)` 模式封装 dws CLI 的读取与回写；`TodoSyncService` 负责 upsert（强制四象限、来源领导、pending 保护、发现时刻补写）、连续两轮消失软删、回写重试、节流与 in-flight 互斥。`tasks` 表单表扩展 5 列（DB 层 snake_case），`POST/GET /api/todo-sync` 路由挂载进现有 Express 应用，由 `server/scheduler.js` 每 30 分钟 cron 触发；`PATCH /api/tasks/:id` 对钉钉来源任务在服务端触发即时回写。前端在待办视图增加「同步钉钉待办」按钮、来源领导徽标、截止时间展示与「同步失败待重试」标记，钉钉任务删除按钮禁用；日报数据源附带 `source`/`sourceLeader`，`ReportSourceSummary` 展示钉钉来源统计。

**Tech Stack:** Node.js（ESM）+ Express 4 + mysql2/promise + node-cron + p-limit（新增，详情并发限 5）+ dws CLI（dingtalk-workspace-cli，经 `node.exe + dws.js` 调用）；前端 React 18 + Vite 8 + JavaScript；测试 Vitest 4 + supertest + React Testing Library。

## Global Constraints

> 以下约束原文取自 spec §3（本期不包含）、§5（约束规则）、§6（同步机制）、§7（日报口径）、§10（错误处理），实现时不得偏离。

- 导入时**强制** `important=1, urgent=1`（锁定「重要·紧急」象限）；每次同步**重置**这两个字段，防误改
- **标题锁定**：钉钉来源任务标题不可编辑（PATCH 忽略 `title` 修改），与删除禁用一致，数据完全以钉钉为准
- **三锁定**：四象限（important/urgent）、标题、删除 全部锁定；计时（开始/暂停）不受影响仍可操作
- `completed_at` 只由**本地勾选时刻**或**钉钉侧完成发现时刻补写**（见 §6.2）
- **删除规则**：钉钉来源任务在 prodash **不可删除**（前端按钮禁用 + 后端 `DELETE /api/tasks/:id` 拒绝，双保险）；钉钉侧任务消失由同步软删本地副本（`status='deleted'`），不调钉钉删除接口
- 软删除本地任务保留 `source_leader` 等元数据
- **软删判定**：钉钉侧**连续 2 次同步**（跨 2 个周期）均查不到才软删本地副本；仅置 `status='deleted'` 保留数据，不提供 UI 恢复入口
- **完成状态保护（pending 不回退）**：轮询更新完成状态时，若本地 `status='completed'` 且 `sync_writeback='pending'`（待回写），则**保留本地状态不回退**；钉钉回写成功后才允许同步覆盖
- 节流：页面加载触发时，若距上次同步 < 2 分钟则跳过（不重复全量拉取）。同步在后端**异步执行**，不阻塞页面请求。
- 回写失败 → `sync_writeback='pending'`，下次轮询重试；**无限重试**（数据最终一致，不设上限）；成功后清除标记
- **反向**：钉钉侧被标记完成 → 轮询发现 → 本地标记 `status='completed'`；若本地无 `completed_at`，用**首次发现时刻补写** `completed_at`（保证领导任务完成记录进入日报）；若本地已有 `completed_at`（本地先勾选）则保留
- **必须显式配置**：所有 dws todo 调用（拉取 + 回写）均显式传 `--profile`，**不依赖 dws 全局默认 profile**（默认 profile 可能随 `dws profile switch` / token 刷新变化，导致跨组织漂移）
- 未配置时同步启动 **fail-fast 报错**（不再静默降级）
- 钉钉同步任务参与日报数据源：当日完成（本地 `completed_at`）+ 进行中任务均计入，Dify 变量中附带 `source` / `source_leader`
- 「今日完成」归属 `completed_at`，其来源优先级：**本地勾选时刻**（用户在 prodash 勾选完成）；**钉钉侧完成发现时刻补写**：首次发现钉钉侧已完成且本地无 `completed_at` 时，用发现时刻补写——保证领导任务（用户常在钉钉 App 直接勾选完成）的完成记录不缺失
- `time_summary` 等计时维度不受影响（计时只在本地）
- 调度与同步并发：轮询与手动触发互斥（in-flight 标记），避免并发 upsert 竞争
- 单任务 `task get` 失败：跳过该任务 `source_leader`（留空），不影响其余任务导入；详情并发获取限 5 个
- 本期不包含：双向任务创建（个人任务不上钉钉）；钉钉侧计时同步（无此概念）；从 prodash 删除钉钉任务并回写钉钉（钉钉任务在 prodash 不可删除）；从钉钉回填**真实完成时刻**（钉钉 `finishTime=0` 不可用；`completed_at` 仅来自本地勾选时刻或同步发现时刻补写，见 §6.2）；循环任务的实例展开（按钉钉返回的每条任务原样导入）

**字段命名约定**（全文统一）：DB 层 snake_case（`dingtalk_task_id`、`source_leader`、`due_time`、`sync_origin`、`sync_writeback`）；repos/API/前端 camelCase（`dingtalkTaskId`、`sourceLeader`、`dueTime`、`syncOrigin`、`syncWriteback`）。`source` 两处同名（ENUM 列与 dws 详情字段）不冲突。

---

### Task 1: Schema 迁移与 Repos 扩展

**Files:**
- Modify: `server/schema.sql`（tasks CREATE TABLE 增加 5 列，保证全新容器首启即含新列）
- Modify: `server/repos/mysql.js`（`TASK_COLUMNS`、`mapTask`、`create`、`update` + 新增 `getByDingtalkTaskId`、`setSyncWriteback`）
- Modify: `server/repos/in-memory.js`（`create`、`update` + 新增 `getByDingtalkTaskId`、`setSyncWriteback`）
- Test: `server/repos/in-memory.test.js`（新建）
- Test: `server/repos/mysql.test.js`（新建，用 mock pool 验证 SQL 与字段映射，不连真实库）

**Interfaces:**
- Consumes: `server/repos/timeutil.js` 的 `toIso` / `isoToSql`（现有，不做改动）
- Produces:
  - `repos.tasks.create({ title, important, urgent, status?, completedAt?, dingtalkTaskId?, source?, sourceLeader?, dueTime?, syncOrigin?, syncWriteback? })` → task（camelCase，含新字段）
  - `repos.tasks.update(id, patch)` → task；patch 新增键：`dingtalkTaskId`、`source`、`sourceLeader`、`dueTime`、`syncOrigin`、`syncWriteback`、`completedAt`（显式补写，ISO 字符串；与 `status` 分支互斥处理）
  - `repos.tasks.getByDingtalkTaskId(taskId)` → task | null
  - `repos.tasks.setSyncWriteback(id, status)` → task（status ∈ `'none' | 'pending'`）
  - `repos.tasks.list()` / `get(id)` 返回对象新增 `dingtalkTaskId/source/sourceLeader/dueTime/syncOrigin/syncWriteback`（camelCase）

- [ ] **Step 1: 写失败测试**

`server/repos/in-memory.test.js`：

```js
// 内存仓库同步字段测试：新字段读写 + 新函数。
import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryRepos } from './in-memory.js';

let repos;
beforeEach(() => {
  repos = createInMemoryRepos();
});

describe('taskRepo 钉钉同步字段', () => {
  it('create 接受钉钉字段，list/get 原样返回（camelCase）', async () => {
    const t = await repos.tasks.create({
      title: '领导任务',
      important: true,
      urgent: true,
      status: 'active',
      completedAt: null,
      dingtalkTaskId: 'dt-1',
      source: 'dingtalk',
      sourceLeader: '闫佳琪',
      dueTime: '2026-08-08T10:00:00.000Z',
      syncOrigin: 'certify_todo',
      syncWriteback: 'none',
    });
    expect(t.dingtalkTaskId).toBe('dt-1');
    expect(t.source).toBe('dingtalk');
    expect(t.sourceLeader).toBe('闫佳琪');
    const listed = await repos.tasks.list();
    expect(listed[0]).toMatchObject({
      dingtalkTaskId: 'dt-1',
      source: 'dingtalk',
      sourceLeader: '闫佳琪',
      dueTime: '2026-08-08T10:00:00.000Z',
      syncOrigin: 'certify_todo',
      syncWriteback: 'none',
    });
  });

  it('本地任务缺省 source=local / syncWriteback=none', async () => {
    const t = await repos.tasks.create({ title: '本地', important: false, urgent: false });
    expect(t.source).toBe('local');
    expect(t.syncWriteback).toBe('none');
    expect(t.dingtalkTaskId).toBeNull();
    expect(t.dueTime).toBeNull();
  });

  it('update 支持新字段与显式 completedAt', async () => {
    const t = await repos.tasks.create({ title: 'a', important: false, urgent: false });
    const updated = await repos.tasks.update(t.id, {
      important: true,
      urgent: true,
      dueTime: '2026-08-08T10:00:00.000Z',
      syncOrigin: 'attendance',
      syncWriteback: 'pending',
      status: 'completed',
      completedAt: '2026-08-07T12:00:00.000Z',
    });
    expect(updated.important).toBe(true);
    expect(updated.urgent).toBe(true);
    expect(updated.completedAt).toBe('2026-08-07T12:00:00.000Z'); // 显式补写优先
    expect(updated.syncWriteback).toBe('pending');
  });

  it('status=active 且未显式传 completedAt 时清空 completedAt', async () => {
    const t = await repos.tasks.create({
      title: 'a', important: true, urgent: true,
      status: 'completed', completedAt: '2026-08-07T12:00:00.000Z',
    });
    const updated = await repos.tasks.update(t.id, { status: 'active' });
    expect(updated.completedAt).toBeNull();
  });

  it('getByDingtalkTaskId 与 setSyncWriteback', async () => {
    const t = await repos.tasks.create({
      title: 'dt', important: true, urgent: true,
      dingtalkTaskId: 'dt-9', source: 'dingtalk',
    });
    const found = await repos.tasks.getByDingtalkTaskId('dt-9');
    expect(found.id).toBe(t.id);
    expect(await repos.tasks.getByDingtalkTaskId('missing')).toBeNull();
    const after = await repos.tasks.setSyncWriteback(t.id, 'pending');
    expect(after.syncWriteback).toBe('pending');
  });
});
```

`server/repos/mysql.test.js`：

```js
// MySQL 仓库同步字段测试：用 mock pool 验证 SQL 列名与 snake_case→camelCase 映射，不连真实库。
import { describe, it, expect, vi } from 'vitest';
import { createMysqlRepos } from './mysql.js';

function makePool() {
  const execute = vi.fn(async () => [[]]);
  return { pool: { execute }, execute };
}

describe('mysql taskRepo 钉钉同步字段', () => {
  it('create 的 INSERT 包含全部新列（snake_case）', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }]).mockResolvedValueOnce([[]]); // create → get 返回空
    const repos = createMysqlRepos(pool);
    await repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: '2026-08-08T10:00:00.000Z', syncOrigin: 'certify_todo', syncWriteback: 'none',
    });
    const sql = execute.mock.calls[0][0];
    expect(sql).toContain('dingtalk_task_id');
    expect(sql).toContain('source_leader');
    expect(sql).toContain('due_time');
    expect(sql).toContain('sync_origin');
    expect(sql).toContain('sync_writeback');
  });

  it('list 映射 snake_case → camelCase', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[
      { id: 1, title: 'dt', important: 1, urgent: 1, status: 'active',
        created_at: '2026-08-07T10:00:00.000Z', completed_at: null, deleted_at: null,
        dingtalk_task_id: 'dt-1', source: 'dingtalk', source_leader: '闫佳琪',
        due_time: '2026-08-08T10:00:00.000Z', sync_origin: 'certify_todo', sync_writeback: 'pending' },
    ]]);
    const repos = createMysqlRepos(pool);
    const rows = await repos.tasks.list();
    expect(rows[0]).toMatchObject({
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: '2026-08-08T10:00:00.000Z', syncOrigin: 'certify_todo', syncWriteback: 'pending',
    });
  });

  it('getByDingtalkTaskId / setSyncWriteback 的 SQL', async () => {
    const { pool, execute } = makePool();
    const repos = createMysqlRepos(pool);
    await repos.tasks.getByDingtalkTaskId('dt-1');
    expect(execute.mock.calls[0][0]).toContain('WHERE dingtalk_task_id = ?');
    expect(execute.mock.calls[0][1]).toEqual(['dt-1']);

    execute.mockReset();
    execute.mockImplementation(async () => [[]]);
    await repos.tasks.setSyncWriteback(5, 'pending');
    expect(execute.mock.calls[0][0]).toContain('SET sync_writeback = ?');
    expect(execute.mock.calls[0][1]).toEqual(['pending', expect.any(String), 5]);
  });
});
```

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- server/repos/in-memory.test.js server/repos/mysql.test.js`

Expected: FAIL——`createInMemoryRepos` / `createMysqlRepos` 尚不支持新字段，断言全部失败。

- [ ] **Step 3: 最小实现**

`server/schema.sql` 的 tasks 建表内追加 5 列（fresh install 生效）：

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  important TINYINT(1) NOT NULL DEFAULT 0,
  urgent TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active', 'completed', 'deleted') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  dingtalk_task_id VARCHAR(64) NULL UNIQUE,
  source ENUM('local','dingtalk') NOT NULL DEFAULT 'local',
  source_leader VARCHAR(100) NULL,
  due_time DATETIME(3) NULL,
  sync_origin VARCHAR(100) NULL,
  sync_writeback ENUM('none','pending') NOT NULL DEFAULT 'none',
  INDEX idx_tasks_status_created (status, created_at),
  INDEX idx_tasks_status_completed (status, completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

对已存在的数据库执行迁移（docker 初始化脚本仅首启生效，运行中库需手工执行）：

```bash
docker compose exec -T mysql mysql -uprodash -pprodash prodash -e "ALTER TABLE tasks ADD COLUMN dingtalk_task_id VARCHAR(64) NULL UNIQUE, ADD COLUMN source ENUM('local','dingtalk') NOT NULL DEFAULT 'local', ADD COLUMN source_leader VARCHAR(100) NULL, ADD COLUMN due_time DATETIME(3) NULL, ADD COLUMN sync_origin VARCHAR(100) NULL, ADD COLUMN sync_writeback ENUM('none','pending') NOT NULL DEFAULT 'none';"
```

`server/repos/mysql.js` 改动：

```js
const TASK_COLUMNS =
  'id, title, important, urgent, status, created_at, completed_at, deleted_at, ' +
  'dingtalk_task_id, source, source_leader, due_time, sync_origin, sync_writeback';

function mapTask(row) {
  return {
    id: row.id,
    title: row.title,
    important: !!row.important,
    urgent: !!row.urgent,
    status: row.status,
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
    deletedAt: toIso(row.deleted_at),
    dingtalkTaskId: row.dingtalk_task_id ?? null,
    source: row.source ?? 'local',
    sourceLeader: row.source_leader ?? null,
    dueTime: toIso(row.due_time),
    syncOrigin: row.sync_origin ?? null,
    syncWriteback: row.sync_writeback ?? 'none',
  };
}
```

`taskRepo.create` 替换为：

```js
async create({ title, important, urgent, status = 'active', completedAt = null,
               dingtalkTaskId = null, source = 'local', sourceLeader = null,
               dueTime = null, syncOrigin = null, syncWriteback = 'none' }) {
  const now = new Date().toISOString();
  const completedAtIso = status === 'completed' ? toIso(completedAt ?? now) : null;
  const dueTimeIso = toIso(dueTime);
  const [r] = await pool.execute(
    `INSERT INTO tasks (title, important, urgent, status, created_at, completed_at, updated_at,
                        dingtalk_task_id, source, source_leader, due_time, sync_origin, sync_writeback)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, important ? 1 : 0, urgent ? 1 : 0, status, isoToSql(now),
     completedAtIso ? isoToSql(completedAtIso) : null, isoToSql(now),
     dingtalkTaskId, source, sourceLeader, dueTimeIso ? isoToSql(dueTimeIso) : null,
     syncOrigin, syncWriteback]
  );
  return {
    id: r.insertId,
    title,
    important: !!important,
    urgent: !!urgent,
    status,
    createdAt: now,
    completedAt: completedAtIso,
    deletedAt: null,
    dingtalkTaskId,
    source,
    sourceLeader,
    dueTime: dueTimeIso,
    syncOrigin,
    syncWriteback,
  };
},
```

`taskRepo.update` 的 status 分支替换为（显式 `completedAt` 优先，避免与下方分支双写同一列），并在其后追加新字段分支：

```js
if ('status' in patch) {
  sets.push('status = ?');
  params.push(patch.status);
  if (patch.status === 'completed' && !existing.completedAt && !('completedAt' in patch)) {
    const now = new Date().toISOString();
    sets.push('completed_at = ?');
    params.push(isoToSql(now));
  } else if (patch.status === 'active' && !('completedAt' in patch)) {
    sets.push('completed_at = NULL');
  }
}
if ('dingtalkTaskId' in patch) {
  sets.push('dingtalk_task_id = ?');
  params.push(patch.dingtalkTaskId ?? null);
}
if ('source' in patch) {
  sets.push('source = ?');
  params.push(patch.source);
}
if ('sourceLeader' in patch) {
  sets.push('source_leader = ?');
  params.push(patch.sourceLeader ?? null);
}
if ('dueTime' in patch) {
  sets.push('due_time = ?');
  params.push(patch.dueTime ? isoToSql(toIso(patch.dueTime)) : null);
}
if ('syncOrigin' in patch) {
  sets.push('sync_origin = ?');
  params.push(patch.syncOrigin ?? null);
}
if ('syncWriteback' in patch) {
  sets.push('sync_writeback = ?');
  params.push(patch.syncWriteback);
}
if ('completedAt' in patch) {
  sets.push('completed_at = ?');
  params.push(patch.completedAt ? isoToSql(toIso(patch.completedAt)) : null);
}
```

`taskRepo` 追加两个新函数：

```js
async getByDingtalkTaskId(taskId) {
  const [rows] = await pool.execute(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE dingtalk_task_id = ?`,
    [taskId]
  );
  return rows.length ? mapTask(rows[0]) : null;
},
async setSyncWriteback(id, status) {
  const now = new Date().toISOString();
  await pool.execute(
    `UPDATE tasks SET sync_writeback = ?, updated_at = ? WHERE id = ?`,
    [status, isoToSql(now), id]
  );
  return this.get(id);
},
```

`server/repos/in-memory.js` 改动：

```js
async create({ title, important, urgent, status = 'active', completedAt = null,
               dingtalkTaskId = null, source = 'local', sourceLeader = null,
               dueTime = null, syncOrigin = null, syncWriteback = 'none' }) {
  const now = new Date().toISOString();
  const t = {
    id: taskSeq++,
    title,
    important: !!important,
    urgent: !!urgent,
    status,
    createdAt: now,
    completedAt,
    deletedAt: null,
    dingtalkTaskId,
    source,
    sourceLeader,
    dueTime,
    syncOrigin,
    syncWriteback,
  };
  tasks.push(t);
  return clone(t);
},
async update(id, patch) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  if ('title' in patch) t.title = patch.title;
  if ('important' in patch) t.important = !!patch.important;
  if ('urgent' in patch) t.urgent = !!patch.urgent;
  if ('dingtalkTaskId' in patch) t.dingtalkTaskId = patch.dingtalkTaskId ?? null;
  if ('source' in patch) t.source = patch.source;
  if ('sourceLeader' in patch) t.sourceLeader = patch.sourceLeader ?? null;
  if ('dueTime' in patch) t.dueTime = patch.dueTime ?? null;
  if ('syncOrigin' in patch) t.syncOrigin = patch.syncOrigin ?? null;
  if ('syncWriteback' in patch) t.syncWriteback = patch.syncWriteback;
  if ('status' in patch) {
    t.status = patch.status;
    if (patch.status === 'completed' && !t.completedAt && !('completedAt' in patch)) {
      t.completedAt = new Date().toISOString();
    } else if (patch.status === 'active' && !('completedAt' in patch)) {
      t.completedAt = null;
    }
  }
  if ('completedAt' in patch) t.completedAt = patch.completedAt;
  return clone(t);
},
async getByDingtalkTaskId(taskId) {
  const t = tasks.find((x) => x.dingtalkTaskId === taskId);
  return t ? clone(t) : null;
},
async setSyncWriteback(id, status) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  t.syncWriteback = status;
  return clone(t);
},
```

- [ ] **Step 4: 验证通过**

Run: `npm test -- server/repos/in-memory.test.js server/repos/mysql.test.js`

Expected: PASS（in-memory 与 mysql mock pool 两个测试文件全部通过；再跑 `npm test` 确认既有测试不回归——`create`/`update` 缺省参数保证旧调用兼容）。

- [ ] **Step 5: 提交**

```bash
git add server/schema.sql server/repos/mysql.js server/repos/in-memory.js server/repos/in-memory.test.js server/repos/mysql.test.js
git commit -m "feat: extend task repo with dingtalk sync fields"
```

---

### Task 2: DwsTodoClient（读 + 写）

**Files:**
- Create: `server/todoSync/dwsTodoClient.js`
- Test: `server/todoSync/dwsTodoClient.test.js`（新建）

**Interfaces:**
- Consumes: 无（纯新模块；execFile 模式参考 `server/publishers/index.js` 的 `DwsCliPublisher`）
- Produces:
  - `new DwsTodoClient({ dwsBin?, dwsScript?, profile?, execFileImpl?, timeoutMs? })`
  - `client.listMyTasks({ roleTypes?, status, profile?, pageSize? })` → `Promise<Array<{ taskId, subject, isDone, dueTime, bizTag }>>`（自动翻页直至 `hasMore=false`）
  - `client.getTaskDetail({ taskId, profile? })` → `Promise<{ subject, creatorInfo: { name, userId }, dueTime, executorInfos, isDone, priority, bizTag, source }>`
  - `client.setTaskDone({ taskId, status, profile? })` → `Promise<object>`（status 为布尔，映射 `--status true|false`）
  - 导出纯函数 `parseDwsJson(stdout)` / `extractListPayload(root)` / `mapTodoItem(item)` 供测试与复用

- [ ] **Step 1: 写失败测试**

`server/todoSync/dwsTodoClient.test.js`：

```js
// @vitest-environment node
// DwsTodoClient 测试：mock execFile，验证参数组装、翻页、输出解析、缺 profile 与超时。
import { describe, it, expect, vi } from 'vitest';
import { DwsTodoClient, parseDwsJson, extractListPayload, mapTodoItem } from './dwsTodoClient.js';

function makeClient(impl) {
  return new DwsTodoClient({
    dwsBin: 'node.exe',
    dwsScript: 'dws.js',
    profile: 'corp:user',
    execFileImpl: impl,
    timeoutMs: 1000,
  });
}

describe('parseDwsJson / extractListPayload / mapTodoItem', () => {
  it('parseDwsJson 容错前缀文案，非 JSON 返回 null', () => {
    expect(parseDwsJson('加载中... {"data":{"list":[]}} 完成')).toEqual({ data: { list: [] } });
    expect(parseDwsJson('不是 JSON')).toBeNull();
  });

  it('extractListPayload 兼容 data.list / data.items / 根级 list 与 hasMore', () => {
    expect(extractListPayload({ data: { list: [1], hasMore: true } })).toEqual({ items: [1], hasMore: true });
    expect(extractListPayload({ data: { items: [1, 2], has_more: true } })).toEqual({ items: [1, 2], hasMore: true });
    expect(extractListPayload({ list: [] })).toEqual({ items: [], hasMore: false });
  });

  it('mapTodoItem 归一化字段（驼峰/下划线别名）', () => {
    expect(mapTodoItem({ taskId: 't1', subject: 'A', isDone: true, dueTime: '2026-08-08T10:00:00.000Z', bizTag: 'certify_todo' }))
      .toEqual({ taskId: 't1', subject: 'A', isDone: true, dueTime: '2026-08-08T10:00:00.000Z', bizTag: 'certify_todo' });
    expect(mapTodoItem({ task_id: 't2', title: 'B', status: 'completed' }))
      .toEqual({ taskId: 't2', subject: 'B', isDone: true, dueTime: null, bizTag: null });
  });
});

describe('listMyTasks', () => {
  it('自动翻页直到 hasMore=false，参数组装含 --profile', async () => {
    const execFile = vi.fn()
      .mockResolvedValueOnce({ stdout: JSON.stringify({ data: { list: [{ taskId: 't1', subject: 'A', isDone: false }], hasMore: true } }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ data: { list: [{ taskId: 't2', subject: 'B', isDone: true }], hasMore: false } }) });
    const client = makeClient(execFile);
    const items = await client.listMyTasks({ status: 'active' });
    expect(items.map((i) => i.taskId)).toEqual(['t1', 't2']);
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile.mock.calls[0][0]).toBe('node.exe');
    expect(execFile.mock.calls[0][1]).toEqual(expect.arrayContaining([
      'todo', '+get-my-tasks', '--role-types', 'executor', '--status', 'active',
      '--profile', 'corp:user', '--format', 'json',
    ]));
    expect(execFile.mock.calls[1][1]).toContain('--page-num');
    expect(execFile.mock.calls[1][1]).toContain('2');
  });
});

describe('getTaskDetail', () => {
  it('归一化详情字段并传 --task-id', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        data: {
          task: {
            subject: '领导任务',
            creatorInfo: { name: '闫佳琪', userId: 'u1' },
            dueTime: '2026-08-08T10:00:00.000Z',
            executorInfos: [],
            isDone: false,
            priority: 1,
            bizTag: 'certify_todo',
            source: 'certify_todo',
          },
        },
      }),
    });
    const client = makeClient(execFile);
    const detail = await client.getTaskDetail({ taskId: 'dt-1' });
    expect(detail).toMatchObject({
      subject: '领导任务',
      creatorInfo: { name: '闫佳琪', userId: 'u1' },
      dueTime: '2026-08-08T10:00:00.000Z',
      isDone: false,
      bizTag: 'certify_todo',
      source: 'certify_todo',
    });
    expect(execFile.mock.calls[0][1]).toEqual(expect.arrayContaining(['todo', 'task', 'get', '--task-id', 'dt-1', '--profile', 'corp:user']));
  });
});

describe('setTaskDone', () => {
  it('组装 --status true/false 与 --profile', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '{"ok":true}' });
    const client = makeClient(execFile);
    await client.setTaskDone({ taskId: 'dt-1', status: true });
    await client.setTaskDone({ taskId: 'dt-2', status: false });
    expect(execFile.mock.calls[0][1]).toEqual(expect.arrayContaining([
      'todo', 'task', 'done', '--task-id', 'dt-1', '--status', 'true', '--profile', 'corp:user', '--format', 'json',
    ]));
    expect(execFile.mock.calls[1][1]).toContain('--status');
    expect(execFile.mock.calls[1][1]).toContain('false');
  });
});

describe('fail-fast 与超时', () => {
  it('缺 profile 时抛错（不静默用 dws 默认 profile）', async () => {
    const client = new DwsTodoClient({ dwsBin: 'node.exe', execFileImpl: vi.fn() });
    await expect(client.listMyTasks({ status: 'active' })).rejects.toThrow(/DINGTALK_TODO_PROFILE/);
  });

  it('execFile 超时/失败向上抛', async () => {
    const execFile = vi.fn().mockRejectedValue(Object.assign(new Error('ETIMEDOUT'), { killed: true }));
    const client = makeClient(execFile);
    await expect(client.setTaskDone({ taskId: 'dt-1', status: true })).rejects.toThrow('ETIMEDOUT');
  });
});
```

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- server/todoSync/dwsTodoClient.test.js`

Expected: FAIL——`server/todoSync/dwsTodoClient.js` 模块不存在。

- [ ] **Step 3: 最小实现**

`server/todoSync/dwsTodoClient.js`：

```js
// 钉钉待办 dws CLI 客户端（读 + 写）。
// 与 DwsCliPublisher 同源调用模式：execFile(node.exe, dws.js, args)，非 shell 拼接；
// 所有输出经 parseDwsJson 容错（整体 JSON.parse 失败则取首个 { 到末尾 }）。
// profile 显式传 --profile（spec §6.3：不依赖 dws 全局默认 profile），缺失即 fail-fast 抛错。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 1000; // 防死循环上限

/** 容错解析 dws stdout：整体 JSON.parse 失败则取首个 { 到末尾 } 再解析（兼容前缀文案）。 */
export function parseDwsJson(stdout) {
  const text = String(stdout ?? '');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** 从列表响应中 lenient 提取 { items, hasMore }（兼容 data.list / data.items / 根级 list）。 */
export function extractListPayload(root) {
  const data = root?.data && typeof root.data === 'object' ? root.data : root;
  const raw = data?.list ?? data?.items ?? data?.result ?? root?.list ?? [];
  const items = Array.isArray(raw) ? raw : [];
  const hasMore = Boolean(data?.hasMore ?? data?.has_more ?? false);
  return { items, hasMore };
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return null;
}

/** 列表项 → 归一化待办（字段名兼容驼峰/下划线）。 */
export function mapTodoItem(item) {
  const isDone = pick(item, ['isDone', 'is_done', 'finished']);
  return {
    taskId: String(pick(item, ['taskId', 'task_id', 'id'])),
    subject: pick(item, ['subject', 'title', 'content']) ?? '',
    isDone: isDone !== null ? Boolean(isDone) : pick(item, ['status', 'state']) === 'completed',
    dueTime: pick(item, ['dueTime', 'due_time']) ?? null,
    bizTag: pick(item, ['bizTag', 'biz_tag', 'source']) ?? null,
  };
}

export class DwsTodoClient {
  constructor({ dwsBin = 'dws', dwsScript, profile, execFileImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.dwsBin = dwsBin;
    this.dwsScript = dwsScript;
    this.profile = profile;
    this.execFile = execFileImpl || execFileAsync;
    this.timeoutMs = timeoutMs;
  }

  resolveProfile(profile) {
    const p = profile ?? this.profile;
    if (!p) {
      throw new Error('DINGTALK_TODO_PROFILE 未配置（dws todo 调用需要显式 --profile）');
    }
    return p;
  }

  async run(args) {
    const { stdout } = await this.execFile(
      this.dwsBin,
      this.dwsScript ? [this.dwsScript, ...args] : args,
      { maxBuffer: 16 * 1024 * 1024, timeout: this.timeoutMs }
    );
    return parseDwsJson(stdout);
  }

  /** 拉取指定状态的我的待办，自动翻页直到 hasMore=false。 */
  async listMyTasks({ roleTypes = ['executor'], status, profile, pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const p = this.resolveProfile(profile);
    const items = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const args = [
        'todo', '+get-my-tasks',
        '--role-types', (Array.isArray(roleTypes) ? roleTypes : [roleTypes]).join(','),
        '--status', status,
        '--page-size', String(pageSize),
        '--page-num', String(page),
        '--profile', p,
        '--format', 'json',
      ];
      const root = (await this.run(args)) ?? {};
      const { items: pageItems, hasMore } = extractListPayload(root);
      items.push(...pageItems.map(mapTodoItem));
      if (!hasMore || pageItems.length === 0) break;
      if (++page > MAX_PAGES) break;
    }
    return items;
  }

  /** 详情：取 creatorInfo.name 作为来源领导（列表不返回，仅新任务调用）。 */
  async getTaskDetail({ taskId, profile } = {}) {
    const p = this.resolveProfile(profile);
    const root =
      (await this.run([
        'todo', 'task', 'get',
        '--task-id', String(taskId),
        '--profile', p,
        '--format', 'json',
      ])) ?? {};
    const data = root?.data && typeof root.data === 'object' ? root.data : root;
    const detail = data?.task ?? data?.detail ?? data?.todo ?? data;
    const creator = detail?.creatorInfo ?? detail?.creator ?? {};
    return {
      subject: pick(detail, ['subject', 'title', 'content']) ?? '',
      creatorInfo: {
        name: pick(creator, ['name', 'displayName', 'display_name', 'nick']) ?? null,
        userId: pick(creator, ['userId', 'user_id', 'unionId']) ?? null,
      },
      dueTime: pick(detail, ['dueTime', 'due_time']) ?? null,
      executorInfos: detail?.executorInfos ?? detail?.executors ?? [],
      isDone: Boolean(
        pick(detail, ['isDone', 'is_done', 'finished']) ?? detail?.status === 'completed'
      ),
      priority: pick(detail, ['priority']) ?? null,
      bizTag: pick(detail, ['bizTag', 'biz_tag', 'source']) ?? null,
      source: pick(detail, ['source', 'bizTag', 'biz_tag']) ?? null,
    };
  }

  /** 完成/取消完成回写：--status true/false。 */
  async setTaskDone({ taskId, status, profile } = {}) {
    const p = this.resolveProfile(profile);
    const root = await this.run([
      'todo', 'task', 'done',
      '--task-id', String(taskId),
      '--status', status ? 'true' : 'false',
      '--profile', p,
      '--format', 'json',
    ]);
    return root ?? {};
  }
}
```

- [ ] **Step 4: 验证通过**

Run: `npm test -- server/todoSync/dwsTodoClient.test.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/todoSync/dwsTodoClient.js server/todoSync/dwsTodoClient.test.js
git commit -m "feat: add dws todo client for dingtalk read/write"
```

---

### Task 3: TodoSyncService 核心（upsert + 强制四象限 + 来源领导 + pending 保护 + 发现时刻补写）

**Files:**
- Create: `server/todoSync/todoSyncService.js`
- Test: `server/todoSync/todoSyncService.test.js`（新建；Task 4 / Task 6 继续扩展同一测试文件）

**Interfaces:**
- Consumes: `DwsTodoClient`（`listMyTasks` / `getTaskDetail` / `setTaskDone`）；`repos.tasks`（`list` / `getByDingtalkTaskId` / `create` / `update` / `setSyncWriteback` / `softDelete`）；`p-limit`
- Produces:
  - `createTodoSyncService({ client, repos, profile, now? })` → service（`now` 为可注入时钟，默认 `() => new Date()`）
  - `service.syncFromDingtalk({ now? })` → `Promise<{ syncedAt, imported, updated, softDeleted, writeback: { retried, pending } }>`（进行中返回 `{ inFlight: true }`）
  - `service.throttleSkip()` / `service.withInFlightGuard(fn)` / `service.softDeleteIfGone({ seenIds })` / `service.getStatus()` / `service.isConfigured()` / `service.writebackStatus({ task, status })`（`getStatus`/`isConfigured` 供 Task 5，`softDeleteIfGone` 供 Task 4，`writebackStatus` 供 Task 6）

- [ ] **Step 1: 安装依赖并写失败测试**

先安装并发控制依赖（`p-limit` 为唯一新增依赖，package.json/package-lock.json 随本任务一并提交）：

```bash
npm install p-limit@^6.0.0
```

`server/todoSync/todoSyncService.test.js`：

```js
// @vitest-environment node
// TodoSyncService 测试：mock client + createInMemoryRepos。
// Task 3 覆盖 upsert/强制四象限/来源领导/pending 保护/发现时刻补写/空增量/并发限 5/详情失败留空。
import { describe, it, expect, vi } from 'vitest';
import { createInMemoryRepos } from '../repos/in-memory.js';
import { createTodoSyncService } from './todoSyncService.js';

const NOW = '2026-08-07T10:00:00.000Z';

function makeCtx({ clientOverrides = {} } = {}) {
  const repos = createInMemoryRepos();
  const client = {
    listMyTasks: vi.fn(),
    getTaskDetail: vi.fn(),
    setTaskDone: vi.fn().mockResolvedValue({}),
    ...clientOverrides,
  };
  const service = createTodoSyncService({
    client,
    repos,
    profile: 'corp:user',
    now: () => new Date(NOW),
  });
  return { repos, client, service };
}

describe('syncFromDingtalk upsert', () => {
  it('新任务：强制重要·紧急、来源领导、dueTime、syncOrigin 入库', async () => {
    const ctx = makeCtx();
    ctx.client.listMyTasks
      .mockResolvedValueOnce([{ taskId: 'dt-1', subject: '领导任务', isDone: false, dueTime: '2026-08-08T10:00:00.000Z', bizTag: 'certify_todo' }]) // 未完成
      .mockResolvedValueOnce([]); // 已完成
    ctx.client.getTaskDetail.mockResolvedValue({
      subject: '领导任务',
      creatorInfo: { name: '闫佳琪', userId: 'u1' },
      dueTime: null,
      executorInfos: [],
      isDone: false,
      priority: null,
      bizTag: 'certify_todo',
      source: 'certify_todo',
    });
    const result = await ctx.service.syncFromDingtalk();
    expect(result.imported).toBe(1);
    expect(result.updated).toBe(0);
    const t = (await ctx.repos.tasks.list())[0];
    expect(t.source).toBe('dingtalk');
    expect(t.important).toBe(true);
    expect(t.urgent).toBe(true);
    expect(t.sourceLeader).toBe('闫佳琪');
    expect(t.dueTime).toBe('2026-08-08T10:00:00.000Z');
    expect(t.syncOrigin).toBe('certify_todo');
    expect(t.syncWriteback).toBe('none');
    expect(ctx.client.getTaskDetail).toHaveBeenCalledWith({ taskId: 'dt-1', profile: 'corp:user' });
  });

  it('已存在任务：更新 subject/dueTime/syncOrigin 并重置四象限，不重复取详情', async () => {
    const ctx = makeCtx();
    const created = await ctx.repos.tasks.create({
      title: '旧标题', important: false, urgent: false,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: null, syncOrigin: null, syncWriteback: 'none', status: 'active',
    });
    ctx.client.listMyTasks
      .mockResolvedValueOnce([{ taskId: 'dt-1', subject: '新标题', isDone: false, dueTime: '2026-08-09T09:00:00.000Z', bizTag: 'attendance' }])
      .mockResolvedValueOnce([]);
    const result = await ctx.service.syncFromDingtalk();
    expect(result.updated).toBe(1);
    expect(result.imported).toBe(0);
    const t = await ctx.repos.tasks.get(created.id);
    expect(t.title).toBe('新标题');
    expect(t.important).toBe(true);
    expect(t.urgent).toBe(true);
    expect(t.dueTime).toBe('2026-08-09T09:00:00.000Z');
    expect(t.syncOrigin).toBe('attendance');
    expect(t.status).toBe('active');
    expect(ctx.client.getTaskDetail).not.toHaveBeenCalled();
  });

  it('pending 保护：completed+pending 的任务不被轮询改回 active', async () => {
    const ctx = makeCtx();
    await ctx.repos.tasks.create({
      title: 'x', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', syncWriteback: 'pending',
      status: 'completed', completedAt: '2026-08-07T09:00:00.000Z',
    });
    ctx.client.listMyTasks
      .mockResolvedValueOnce([{ taskId: 'dt-1', subject: 'x', isDone: false, dueTime: null, bizTag: null }])
      .mockResolvedValueOnce([]);
    await ctx.service.syncFromDingtalk();
    const t = await ctx.repos.tasks.getByDingtalkTaskId('dt-1');
    expect(t.status).toBe('completed');
    expect(t.completedAt).toBe('2026-08-07T09:00:00.000Z');
  });

  it('发现时刻补写：钉钉已完成且本地无 completed_at → 写发现时刻；本地已有则保留', async () => {
    const ctx = makeCtx();
    const a = await ctx.repos.tasks.create({
      title: 'a', important: true, urgent: true, dingtalkTaskId: 'dt-a', source: 'dingtalk',
      status: 'completed', completedAt: '2026-08-07T08:00:00.000Z', syncWriteback: 'none',
    });
    const b = await ctx.repos.tasks.create({
      title: 'b', important: true, urgent: true, dingtalkTaskId: 'dt-b', source: 'dingtalk',
      status: 'active', syncWriteback: 'none',
    });
    ctx.client.listMyTasks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { taskId: 'dt-a', subject: 'a', isDone: true, dueTime: null, bizTag: null },
        { taskId: 'dt-b', subject: 'b', isDone: true, dueTime: null, bizTag: null },
      ]);
    await ctx.service.syncFromDingtalk();
    expect((await ctx.repos.tasks.get(a.id)).completedAt).toBe('2026-08-07T08:00:00.000Z'); // 保留本地
    expect((await ctx.repos.tasks.get(b.id)).status).toBe('completed');
    expect((await ctx.repos.tasks.get(b.id)).completedAt).toBe(NOW); // 发现时刻补写
  });

  it('钉钉侧无任务：返回空增量不报错', async () => {
    const ctx = makeCtx();
    ctx.client.listMyTasks.mockResolvedValue([]);
    const result = await ctx.service.syncFromDingtalk();
    expect(result).toMatchObject({ imported: 0, updated: 0, softDeleted: 0, writeback: { retried: 0, pending: 0 } });
  });

  it('详情并发获取限 5 个', async () => {
    const ctx = makeCtx();
    let concurrent = 0;
    let maxConcurrent = 0;
    ctx.client.listMyTasks
      .mockResolvedValueOnce(Array.from({ length: 12 }, (_, i) => ({ taskId: `dt-${i}`, subject: `t${i}`, isDone: false, dueTime: null, bizTag: null })))
      .mockResolvedValueOnce([]);
    ctx.client.getTaskDetail.mockImplementation(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent -= 1;
      return { subject: 'x', creatorInfo: { name: null, userId: null }, dueTime: null, executorInfos: [], isDone: false, priority: null, bizTag: null, source: null };
    });
    await ctx.service.syncFromDingtalk();
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });

  it('task get 失败：source_leader 留空，不影响其余任务导入', async () => {
    const ctx = makeCtx();
    ctx.client.listMyTasks
      .mockResolvedValueOnce([{ taskId: 'dt-1', subject: 'x', isDone: false, dueTime: null, bizTag: null }])
      .mockResolvedValueOnce([]);
    ctx.client.getTaskDetail.mockRejectedValue(new Error('dws token 失效'));
    const result = await ctx.service.syncFromDingtalk();
    expect(result.imported).toBe(1);
    const t = await ctx.repos.tasks.getByDingtalkTaskId('dt-1');
    expect(t.sourceLeader).toBeNull();
  });
});
```

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- server/todoSync/todoSyncService.test.js`

Expected: FAIL——`server/todoSync/todoSyncService.js` 模块不存在。

- [ ] **Step 3: 最小实现**

`server/todoSync/todoSyncService.js`（Task 4 / Task 6 会继续扩展本文件；本步实现工厂、`syncFromDingtalk` 的拉取与 upsert 主体、`getStatus`/`isConfigured`；软删/节流/互斥在 Task 4 补齐，回写重试与 `writebackStatus` 在 Task 6 补齐）：

```js
// 钉钉待办同步服务。
// createTodoSyncService({ client, repos, profile, now })：client=DwsTodoClient，repos=仓库组，
// profile=来源组织（corpId:userId），now=可注入时钟（默认 Date）。
// syncFromDingtalk：拉取（未完成+已完成）→ upsert（强制四象限/来源领导/pending 保护/发现时刻补写）。
// 节流（throttleSkip）与 in-flight 互斥（withInFlightGuard）保证并发安全（Task 4 补齐）。

import pLimit from 'p-limit';

const SYNC_THROTTLE_MS = 2 * 60 * 1000;
const DETAIL_CONCURRENCY = 5;

export function createTodoSyncService({ client, repos, profile = '', now = () => new Date() }) {
  let lastSyncAt = null;
  let lastResult = null;
  let inFlight = false;
  const seenLastCycle = new Set(); // 上一轮钉钉侧未见到的 dingtalkTaskId（软删候选）

  function isConfigured() {
    return Boolean(profile);
  }

  function getStatus() {
    return { syncedAt: lastSyncAt, lastResult, profile, inFlight, configured: isConfigured() };
  }

  /** 距上次同步 < 2 分钟 → 返回缓存的上次结果（节流），否则返回 null。 */
  async function throttleSkip() {
    if (lastSyncAt && now().getTime() - new Date(lastSyncAt).getTime() < SYNC_THROTTLE_MS) {
      return lastResult;
    }
    return null;
  }

  /** 互斥锁：已有同步进行中时返回 { inFlight: true }，否则执行 fn 并返回其结果。 */
  async function withInFlightGuard(fn) {
    if (inFlight) return { inFlight: true };
    inFlight = true;
    try {
      return await fn();
    } finally {
      inFlight = false;
    }
  }

  /** upsert：新任务并发取详情（限 5）后插入；已存在则更新 subject/dueTime/syncOrigin 并重置四象限。 */
  async function upsertItems(items, syncedAt) {
    const limit = pLimit(DETAIL_CONCURRENCY);
    const existing = await repos.tasks.list();
    const byDingtalkId = new Map(
      existing.filter((t) => t.dingtalkTaskId).map((t) => [t.dingtalkTaskId, t])
    );
    const seenIds = new Set(items.map((i) => i.taskId));
    const newItems = items.filter((i) => !byDingtalkId.has(i.taskId));

    const details = await Promise.all(
      newItems.map((item) =>
        limit(() => client.getTaskDetail({ taskId: item.taskId, profile }).catch(() => null))
      )
    );

    let imported = 0;
    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i];
      const detail = details[i];
      await repos.tasks.create({
        title: item.subject,
        important: true,
        urgent: true,
        status: item.isDone ? 'completed' : 'active',
        completedAt: item.isDone ? syncedAt : null, // 钉钉已完成新任务：发现时刻补写 completed_at
        dingtalkTaskId: item.taskId,
        source: 'dingtalk',
        sourceLeader: detail?.creatorInfo?.name ?? null, // 详情失败留空，不阻塞
        dueTime: item.dueTime ?? detail?.dueTime ?? null,
        syncOrigin: item.bizTag ?? detail?.bizTag ?? null,
        syncWriteback: 'none',
      });
      imported += 1;
    }

    let updated = 0;
    for (const item of items) {
      const local = byDingtalkId.get(item.taskId);
      if (!local) continue;
      const patch = {
        title: item.subject,
        important: true,
        urgent: true, // 每次同步重置四象限，防误改
        dueTime: item.dueTime ?? local.dueTime,
        syncOrigin: item.bizTag ?? local.syncOrigin,
      };
      // pending 保护：本地 completed + 待回写 → 保留本地状态不回退
      const pendingProtected = local.status === 'completed' && local.syncWriteback === 'pending';
      if (!pendingProtected) {
        if (item.isDone) {
          patch.status = 'completed';
          if (!local.completedAt) patch.completedAt = syncedAt; // 发现时刻补写
        } else if (local.status === 'completed') {
          patch.status = 'active'; // 钉钉侧恢复未完成 → 本地同步回 active
          patch.completedAt = null;
        }
      }
      await repos.tasks.update(local.id, patch);
      updated += 1;
    }
    return { imported, updated, seenIds };
  }

  /** 主同步：拉取 → upsert（软删/回写重试由 Task 4 / Task 6 接入）。 */
  async function syncFromDingtalk({ now: nowOverride } = {}) {
    const syncedAt = (nowOverride ?? now()).toISOString();
    const run = async () => {
      const [activeItems, completedItems] = await Promise.all([
        client.listMyTasks({ roleTypes: ['executor'], status: 'active', profile }),
        client.listMyTasks({ roleTypes: ['executor'], status: 'completed', profile }),
      ]);
      // 去重（同一任务可能同时出现在两轮拉取中）
      const merged = new Map([...activeItems, ...completedItems].map((i) => [i.taskId, i]));
      const items = [...merged.values()];
      const { imported, updated, seenIds } = await upsertItems(items, syncedAt);
      const softDeleted = await softDeleteIfGone({ seenIds });
      const writeback = await retryWritebacks();
      const result = { syncedAt, imported, updated, softDeleted, writeback };
      lastSyncAt = syncedAt;
      lastResult = result;
      return result;
    };
    return withInFlightGuard(run);
  }

  return {
    isConfigured,
    getStatus,
    throttleSkip,
    withInFlightGuard,
    syncFromDingtalk,
  };
}
```

注：本步代码引用了 `softDeleteIfGone` 与 `retryWritebacks`，二者在 Task 4 / Task 6 中实现于同一文件内（Task 4 结束时测试中「空增量」用例会先跑通，`softDeleteIfGone`/`retryWritebacks` 以 Task 4/6 的实现为准）。

- [ ] **Step 4: 验证通过**

Run: `npm test -- server/todoSync/todoSyncService.test.js`

Expected: PASS（本步先实现 `syncFromDingtalk`/`upsertItems` 与空的 `softDeleteIfGone`/`retryWritebacks` 占位——`softDeleteIfGone` 先返回 0、`retryWritebacks` 先返回 `{ retried: 0, pending: 0 }`，让本步测试通过；Task 4 / Task 6 再替换为完整实现）。

- [ ] **Step 5: 提交**

```bash
git add server/todoSync/todoSyncService.js server/todoSync/todoSyncService.test.js package.json package-lock.json
git commit -m "feat: add todo sync service core upsert logic"
```

---

### Task 4: TodoSyncService 软删 + 节流 + 并发互斥

**Files:**
- Modify: `server/todoSync/todoSyncService.js`（替换 Task 3 的占位：实现 `softDeleteIfGone` 完整逻辑）
- Test: `server/todoSync/todoSyncService.test.js`（追加「软删 / 节流 / 互斥」describe 块）

**Interfaces:**
- Consumes: Task 3 的 `syncFromDingtalk` / `upsertItems`；`repos.tasks.list/getByDingtalkTaskId/softDelete`
- Produces:
  - `service.softDeleteIfGone({ seenIds })` → `Promise<number>`（本轮软删数量）；模块级状态 `seenLastCycle`（Set）、`lastSyncAt`、`lastResult`、`inFlight`
  - `service.throttleSkip()` 语义：距 `lastSyncAt` < 2 分钟返回 cached `lastResult`
  - `service.withInFlightGuard(fn)` 语义：`inFlight=true` 时返回 `{ inFlight: true }`，否则加锁执行并解锁
  - `syncFromDingtalk` 在 upsert 后调用 `softDeleteIfGone({ seenIds })` 并把返回值写入 `result.softDeleted`

- [ ] **Step 1: 写失败测试**

追加到 `server/todoSync/todoSyncService.test.js`（沿用 Task 3 的 `makeCtx` / `NOW`）：

```js
describe('软删 / 节流 / 互斥', () => {
  it('连续 2 次同步未见才软删：第一次仅标记保留', async () => {
    const ctx = makeCtx();
    await ctx.repos.tasks.create({
      title: '消失任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-gone', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    ctx.client.listMyTasks.mockResolvedValue([]); // 两轮都拉不到
    const r1 = await ctx.service.syncFromDingtalk();
    expect(r1.softDeleted).toBe(0);
    expect((await ctx.repos.tasks.getByDingtalkTaskId('dt-gone')).status).toBe('active');
    const r2 = await ctx.service.syncFromDingtalk();
    expect(r2.softDeleted).toBe(1);
    expect((await ctx.repos.tasks.getByDingtalkTaskId('dt-gone')).status).toBe('deleted');
  });

  it('本轮重新出现：从 seenLastCycle 移除，不软删', async () => {
    const ctx = makeCtx();
    await ctx.repos.tasks.create({
      title: 'x', important: true, urgent: true,
      dingtalkTaskId: 'dt-x', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    ctx.client.listMyTasks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ taskId: 'dt-x', subject: 'x', isDone: false, dueTime: null, bizTag: null }]);
    await ctx.service.syncFromDingtalk();
    await ctx.service.syncFromDingtalk();
    expect((await ctx.repos.tasks.getByDingtalkTaskId('dt-x')).status).toBe('active');
  });

  it('已软删任务不重复进候选集', async () => {
    const ctx = makeCtx();
    await ctx.repos.tasks.create({
      title: 'x', important: true, urgent: true,
      dingtalkTaskId: 'dt-x', source: 'dingtalk', status: 'deleted', syncWriteback: 'none',
    });
    ctx.client.listMyTasks.mockResolvedValue([]);
    await ctx.service.syncFromDingtalk();
    await ctx.service.syncFromDingtalk();
    const t = await ctx.repos.tasks.getByDingtalkTaskId('dt-x');
    expect(t.status).toBe('deleted');
    expect(t.title).toBe('x'); // 软删保留元数据
  });

  it('节流：距上次同步 < 2 分钟返回缓存结果，不重新拉取；超过后放行', async () => {
    const ctx = makeCtx();
    ctx.client.listMyTasks.mockResolvedValue([]);
    await ctx.service.syncFromDingtalk(); // 成功 → lastSyncAt=NOW
    ctx.client.listMyTasks.mockClear();
    const cached = await ctx.service.throttleSkip();
    expect(cached).toEqual(expect.objectContaining({ imported: 0, updated: 0 }));
    expect(ctx.client.listMyTasks).not.toHaveBeenCalled();
    // 超过 2 分钟后不再节流（换一个 now 前移的实例）
    const later = createTodoSyncService({
      client: ctx.client, repos: ctx.repos, profile: 'corp:user',
      now: () => new Date('2026-08-07T10:03:00.000Z'),
    });
    expect(await later.throttleSkip()).toBeNull();
  });

  it('互斥：同步进行中时第二个调用返回 { inFlight: true }，不重复拉取', async () => {
    const ctx = makeCtx();
    let release;
    const gate = new Promise((r) => { release = r; });
    ctx.client.listMyTasks.mockImplementation(() => gate); // 两轮拉取都挂起
    const p1 = ctx.service.syncFromDingtalk();
    await new Promise((r) => setTimeout(r, 0)); // 等 withInFlightGuard 置位
    const p2 = await ctx.service.syncFromDingtalk();
    expect(p2).toEqual({ inFlight: true });
    release([]);
    await p1;
    expect(ctx.client.listMyTasks).toHaveBeenCalledTimes(2); // 只有 p1 拉取（active+completed）
  });

  it('同步失败不更新 lastSyncAt（保留上次同步时间）', async () => {
    const ctx = makeCtx();
    ctx.client.listMyTasks.mockRejectedValue(new Error('dws token 失效'));
    await expect(ctx.service.syncFromDingtalk()).rejects.toThrow('dws token 失效');
    expect(ctx.service.getStatus().syncedAt).toBeNull();
  });
});
```

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- server/todoSync/todoSyncService.test.js`

Expected: FAIL——占位 `softDeleteIfGone` 不执行软删，断言失败。

- [ ] **Step 3: 最小实现**

在 `server/todoSync/todoSyncService.js` 中把 Task 3 的占位替换为完整实现（其余部分不动）：

```js
/** 软删判定：本轮出现的 taskId 移出 seenLastCycle；上一轮标记且本轮仍未见 → 软删；本轮未见则仅标记。 */
async function softDeleteIfGone({ seenIds }) {
  for (const id of seenIds) seenLastCycle.delete(id);
  const vanished = [...seenLastCycle].filter((id) => !seenIds.has(id));
  let softDeleted = 0;
  for (const id of vanished) {
    const local = await repos.tasks.getByDingtalkTaskId(id);
    if (local && local.status !== 'deleted') {
      await repos.tasks.softDelete(local.id); // 仅置 status='deleted'，保留元数据，不调钉钉删除接口
      softDeleted += 1;
    }
    seenLastCycle.delete(id);
  }
  const allLocal = await repos.tasks.list();
  for (const t of allLocal) {
    if (
      t.dingtalkTaskId &&
      t.source === 'dingtalk' &&
      t.status !== 'deleted' &&
      !seenIds.has(t.dingtalkTaskId)
    ) {
      seenLastCycle.add(t.dingtalkTaskId);
    }
  }
  return softDeleted;
}
```

同时把 `syncFromDingtalk` 中调用 `softDeleteIfGone` 的结果写入 result（Task 3 已留调用点，确认行）：

```js
const softDeleted = await softDeleteIfGone({ seenIds });
```

- [ ] **Step 4: 验证通过**

Run: `npm test -- server/todoSync/todoSyncService.test.js`

Expected: PASS（Task 3 + Task 4 全部用例）。

- [ ] **Step 5: 提交**

```bash
git add server/todoSync/todoSyncService.js server/todoSync/todoSyncService.test.js
git commit -m "feat: soft delete vanished dingtalk tasks with throttle and in-flight guard"
```

---

### Task 5: Sync Routes + Scheduler Wiring + Profile Fail-Fast

**Files:**
- Create: `server/routes/todoSync.js`
- Create: `server/routes/todoSync.test.js`（新建）
- Modify: `server/app.js`（`createApp` 签名增加 `todoSyncRouter`、`todoSyncService` 可选参数；挂载 `/api/todo-sync`）
- Modify: `server/scheduler.js`（追加 `startTodoSync` / `stopTodoSync`）
- Modify: `server/index.js`（创建 `DwsTodoClient` + `TodoSyncService`；`DINGTALK_TODO_PROFILE` 未配置 fail-fast 打印错误但其他服务正常；注册 scheduler）
- Test: `server/scheduler.test.js`（追加 `startTodoSync` 用例）

**Interfaces:**
- Consumes: `createTodoSyncService`（`isConfigured` / `throttleSkip` / `syncFromDingtalk` / `getStatus`）；`DwsTodoClient`；`createApp`
- Produces:
  - `createTodoSyncRouter({ service })` → express Router，挂载前缀 `/api/todo-sync`
  - `POST /api/todo-sync`：未配置 profile → `503 { error }`；节流命中 → `200` 返回 cached `lastResult`；同步进行中 → `202 { inFlight: true }`；成功 → `200 { syncedAt, imported, updated, softDeleted, writeback }`
  - `GET /api/todo-sync` → `200 { syncedAt, lastResult, profile, inFlight, configured }`
  - `startTodoSync({ cron, run })` / `stopTodoSync()`（cron 默认 `'*/30 * * * *'`，非法 cron 抛错）
  - `createApp({ repos, reportRouter, todoSyncRouter, todoSyncService })`（后两者可选，缺省行为不变）

- [ ] **Step 1: 写失败测试**

`server/routes/todoSync.test.js`：

```js
// @vitest-environment node
// 钉钉同步路由测试（supertest）：service 用 stub 注入。
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTodoSyncRouter } from './todoSync.js';

function makeService(overrides = {}) {
  return {
    isConfigured: () => true,
    throttleSkip: async () => null,
    syncFromDingtalk: async () => ({
      syncedAt: '2026-08-07T12:00:00.000Z', imported: 3, updated: 5,
      softDeleted: 1, writeback: { retried: 2, pending: 0 },
    }),
    getStatus: () => ({ syncedAt: null, lastResult: null, profile: 'corp:user' }),
    ...overrides,
  };
}

function makeApp(service) {
  const app = express();
  app.use(express.json());
  app.use('/api/todo-sync', createTodoSyncRouter({ service }));
  return app;
}

describe('POST /api/todo-sync', () => {
  it('触发同步并返回结果', async () => {
    const sync = vi.fn().mockResolvedValue({
      syncedAt: '2026-08-07T12:00:00.000Z', imported: 3, updated: 5,
      softDeleted: 1, writeback: { retried: 2, pending: 0 },
    });
    const app = makeApp(makeService({ syncFromDingtalk: sync }));
    const res = await request(app).post('/api/todo-sync');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ imported: 3, updated: 5, softDeleted: 1, writeback: { retried: 2, pending: 0 } });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('节流内第二次触发返回缓存结果，不执行同步', async () => {
    const cached = { syncedAt: '2026-08-07T12:00:00.000Z', imported: 0, updated: 0, softDeleted: 0, writeback: { retried: 0, pending: 0 } };
    const sync = vi.fn();
    const app = makeApp(makeService({ throttleSkip: async () => cached, syncFromDingtalk: sync }));
    const res = await request(app).post('/api/todo-sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(cached);
    expect(sync).not.toHaveBeenCalled();
  });

  it('同步进行中返回 202 { inFlight: true }', async () => {
    const app = makeApp(makeService({ syncFromDingtalk: async () => ({ inFlight: true }) }));
    const res = await request(app).post('/api/todo-sync');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ inFlight: true });
  });

  it('未配置 profile → 503 fail-fast', async () => {
    const app = makeApp(makeService({ isConfigured: () => false }));
    const res = await request(app).post('/api/todo-sync');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('DINGTALK_TODO_PROFILE');
  });
});

describe('GET /api/todo-sync', () => {
  it('返回上次同步状态', async () => {
    const app = makeApp(makeService());
    const res = await request(app).get('/api/todo-sync');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ syncedAt: null, lastResult: null, profile: 'corp:user' });
  });
});
```

`server/scheduler.test.js` 追加（沿用现有 import）：

```js
describe('startTodoSync', () => {
  it('非法 cron 抛错；合法每秒 cron 触发 run', async () => {
    expect(() => startTodoSync({ cron: 'not-a-cron', run: async () => {} })).toThrow(/cron/);
    const run = vi.fn().mockResolvedValue({ imported: 0 });
    startTodoSync({ cron: '* * * * * *', run }); // 每秒触发（node-cron 6 段）
    await new Promise((r) => setTimeout(r, 1100));
    expect(run).toHaveBeenCalled();
    stopTodoSync();
  });
});
```

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- server/routes/todoSync.test.js server/scheduler.test.js`

Expected: FAIL——`server/routes/todoSync.js` 不存在；`startTodoSync` 未导出。

- [ ] **Step 3: 最小实现**

`server/routes/todoSync.js`：

```js
// 钉钉待办同步 HTTP 路由（挂载前缀 /api/todo-sync）。
// createTodoSyncRouter({ service })：service 由入口/测试注入。
// POST 为异步触发：节流命中直接返回缓存结果；进行中返回 202；未配置 profile 返回 503。

import { Router } from 'express';

const ah = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export function createTodoSyncRouter({ service }) {
  const router = Router();

  router.post(
    '/',
    ah(async (req, res) => {
      if (!service.isConfigured()) {
        return res.status(503).json({
          error:
            'DINGTALK_TODO_PROFILE 未配置：请先在 .env 配置来源组织（corpId:userId），钉钉待办同步不可用',
        });
      }
      const cached = await service.throttleSkip();
      if (cached) return res.json(cached);
      const result = await service.syncFromDingtalk();
      if (result && result.inFlight) return res.status(202).json({ inFlight: true });
      res.json(result);
    })
  );

  router.get(
    '/',
    ah(async (req, res) => {
      res.json(service.getStatus());
    })
  );

  return router;
}
```

`server/scheduler.js` 追加（保持现有 `startScheduler` 不变）：

```js
let todoSyncCronTask = null;

/**
 * 启动钉钉待办同步 cron 调度（默认每 30 分钟）。
 * run 为同步函数（返回 Promise）；非法 cron 表达式直接抛错。
 * @returns {object} node-cron 任务句柄
 */
export function startTodoSync({ cron: cronExpr = '*/30 * * * *', run }) {
  if (!cron.validate(cronExpr)) {
    throw new Error(`[scheduler] 无效的 cron 表达式: ${cronExpr}`);
  }
  stopTodoSync();
  todoSyncCronTask = cron.schedule(cronExpr, () => {
    run().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[scheduler] todo sync failed:', err?.message || err);
    });
  });
  return todoSyncCronTask;
}

/** 停止当前 todo-sync cron 任务（测试与重启用）。 */
export function stopTodoSync() {
  if (todoSyncCronTask) {
    todoSyncCronTask.stop();
    todoSyncCronTask = null;
  }
}
```

`server/app.js` 改动：

```js
export function createApp({ repos, reportRouter, todoSyncRouter, todoSyncService }) {
  // ...现有代码不变...
  if (reportRouter) {
    app.use('/api/reports', reportRouter);
  }
  if (todoSyncRouter) {
    app.use('/api/todo-sync', todoSyncRouter);
  }
  // ...其余不变...
}
```

`server/index.js` 改动（import 与装配）：

```js
import { DwsTodoClient } from './todoSync/dwsTodoClient.js';
import { createTodoSyncService } from './todoSync/todoSyncService.js';
import { createTodoSyncRouter } from './routes/todoSync.js';
import { startScheduler, startTodoSync } from './scheduler.js';

// 钉钉待办同步：DwsTodoClient 复用 DWS_BIN/DWS_SCRIPT（与 DwsCliPublisher 同源）。
// DINGTALK_TODO_PROFILE 必须显式配置：未配置 → 启动打印错误（fail-fast），
// 同步接口返回 503，其他服务（任务/日报）不受影响。
const dingtalkTodoProfile = process.env.DINGTALK_TODO_PROFILE || '';
const todoSyncClient = new DwsTodoClient({
  dwsBin: process.env.DWS_BIN || 'dws',
  dwsScript: process.env.DWS_SCRIPT,
  profile: dingtalkTodoProfile,
});
if (!dingtalkTodoProfile) {
  console.error(
    '[prodash-server] DINGTALK_TODO_PROFILE 未配置：钉钉待办同步不可用（拉取/回写均需显式 --profile），' +
      '请在 .env 配置来源组织（见 .env.example）。其他服务不受影响。'
  );
}
const todoSyncService = createTodoSyncService({
  client: todoSyncClient,
  repos,
  profile: dingtalkTodoProfile,
});
const todoSyncRouter = createTodoSyncRouter({ service: todoSyncService });
const app = createApp({ repos, reportRouter, todoSyncRouter, todoSyncService });
```

调度器块内追加（保持 NODE_ENV!=='test' 守卫）：

```js
if (process.env.NODE_ENV !== 'test') {
  try {
    startScheduler({ repos, service, cron: process.env.REPORT_CRON });
    startTodoSync({
      cron: process.env.DINGTALK_TODO_SYNC_CRON,
      run: () => todoSyncService.syncFromDingtalk(),
    });
    console.log(
      `[prodash-server] scheduler started (report=${process.env.REPORT_CRON || '0 21 * * *'}, ` +
        `todo-sync=${process.env.DINGTALK_TODO_SYNC_CRON || '*/30 * * * *'})`
    );
  } catch (err) {
    console.error(`[prodash-server] ${err.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: 验证通过**

Run: `npm test -- server/routes/todoSync.test.js server/scheduler.test.js server/app.test.js`

Expected: PASS（新路由/调度测试通过；`createApp` 可选参数不破坏既有 `app.test.js`）。

- [ ] **Step 5: 提交**

```bash
git add server/routes/todoSync.js server/routes/todoSync.test.js server/app.js server/scheduler.js server/scheduler.test.js server/index.js
git commit -m "feat: wire todo sync routes, scheduler and profile fail-fast"
```

---

### Task 6: Patch Writeback（完成 + 取消 + 重试）

**Files:**
- Modify: `server/todoSync/todoSyncService.js`（补齐 `writebackStatus` 与 `retryWritebacks` 实现，并在 `syncFromDingtalk` 中接入）
- Modify: `server/app.js`（PATCH `/api/tasks/:id` 对钉钉来源任务触发回写；失败置 `sync_writeback='pending'`）
- Test: `server/todoSync/todoSyncService.test.js`（追加「writebackStatus 与回写重试」describe 块）
- Test: `server/app.test.js`（追加 PATCH 回写用例；`makeApp` 传入 stub `todoSyncService`）

**Interfaces:**
- Consumes: `repos.tasks.setSyncWriteback`；`client.setTaskDone`；Task 3 的 `syncFromDingtalk`
- Produces:
  - `service.writebackStatus({ task, status })`：非钉钉任务或非 completed/active 直接返回；调 `client.setTaskDone({ taskId, status: status==='completed', profile })`，成功 `setSyncWriteback(id, 'none')`；失败向上抛（路由 catch 置 pending）
  - `service.retryWritebacks()` → `Promise<{ retried, pending }>`：对 `sync_writeback='pending'` 的钉钉任务按本地当前状态重试 `setTaskDone`，成功清除标记，失败计数（无限重试，无上限）
  - PATCH 行为：钉钉任务 `status='completed'` → 即时回写 `--status true`；`status='active'` → 即时回写 `--status false`；回写失败仍更新本地状态并置 `syncWriteback='pending'`

- [ ] **Step 1: 写失败测试**

`server/todoSync/todoSyncService.test.js` 追加：

```js
describe('writebackStatus 与回写重试', () => {
  it('writebackStatus 完成 → setTaskDone(true) 并保持 none', async () => {
    const ctx = makeCtx();
    const t = await ctx.repos.tasks.create({
      title: 'x', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    await ctx.service.writebackStatus({ task: t, status: 'completed' });
    expect(ctx.client.setTaskDone).toHaveBeenCalledWith({ taskId: 'dt-1', status: true, profile: 'corp:user' });
    expect((await ctx.repos.tasks.get(t.id)).syncWriteback).toBe('none');
  });

  it('writebackStatus 取消完成 → setTaskDone(false)', async () => {
    const ctx = makeCtx();
    const t = await ctx.repos.tasks.create({
      title: 'x', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', status: 'completed',
      completedAt: '2026-08-07T09:00:00.000Z', syncWriteback: 'none',
    });
    await ctx.service.writebackStatus({ task: t, status: 'active' });
    expect(ctx.client.setTaskDone).toHaveBeenCalledWith({ taskId: 'dt-1', status: false, profile: 'corp:user' });
  });

  it('writebackStatus 失败向上抛，标记由路由层置 pending（本层不清除）', async () => {
    const ctx = makeCtx();
    const t = await ctx.repos.tasks.create({
      title: 'x', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    ctx.client.setTaskDone.mockRejectedValue(new Error('dws 不可用'));
    await expect(ctx.service.writebackStatus({ task: t, status: 'completed' })).rejects.toThrow('dws 不可用');
    expect((await ctx.repos.tasks.get(t.id)).syncWriteback).toBe('none');
  });

  it('writebackStatus 非钉钉任务 / 非完成状态不调 dws', async () => {
    const ctx = makeCtx();
    const local = await ctx.repos.tasks.create({ title: '本地', important: false, urgent: false });
    await ctx.service.writebackStatus({ task: local, status: 'completed' });
    const dt = await ctx.repos.tasks.create({
      title: 'x', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    await ctx.service.writebackStatus({ task: dt, status: 'active' }); // active→active 无变化
    expect(ctx.client.setTaskDone).not.toHaveBeenCalled();
  });

  it('syncFromDingtalk 重试 pending：成功清除标记，失败计数保留', async () => {
    const ctx = makeCtx();
    await ctx.repos.tasks.create({
      title: 'a', important: true, urgent: true, dingtalkTaskId: 'dt-a', source: 'dingtalk',
      status: 'completed', completedAt: '2026-08-07T09:00:00.000Z', syncWriteback: 'pending',
    });
    await ctx.repos.tasks.create({
      title: 'b', important: true, urgent: true, dingtalkTaskId: 'dt-b', source: 'dingtalk',
      status: 'active', syncWriteback: 'pending',
    });
    ctx.client.listMyTasks.mockResolvedValue([]);
    ctx.client.setTaskDone.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom'));
    const result = await ctx.service.syncFromDingtalk();
    expect(result.writeback).toEqual({ retried: 1, pending: 1 });
    expect((await ctx.repos.tasks.getByDingtalkTaskId('dt-a')).syncWriteback).toBe('none');
    expect((await ctx.repos.tasks.getByDingtalkTaskId('dt-b')).syncWriteback).toBe('pending');
    expect(ctx.client.setTaskDone).toHaveBeenNthCalledWith(1, { taskId: 'dt-a', status: true, profile: 'corp:user' });
    expect(ctx.client.setTaskDone).toHaveBeenNthCalledWith(2, { taskId: 'dt-b', status: false, profile: 'corp:user' });
  });

  it('pending 重试成功后再允许同步覆盖（钉钉侧恢复未完成 → 本地回 active）', async () => {
    const ctx = makeCtx();
    await ctx.repos.tasks.create({
      title: 'x', important: true, urgent: true, dingtalkTaskId: 'dt-1', source: 'dingtalk',
      status: 'completed', completedAt: '2026-08-07T09:00:00.000Z', syncWriteback: 'pending',
    });
    ctx.client.setTaskDone.mockResolvedValue({});
    // 第一轮：重试成功清除标记（upsert 期间仍受 pending 保护）
    ctx.client.listMyTasks.mockResolvedValue([]);
    await ctx.service.syncFromDingtalk();
    expect((await ctx.repos.tasks.getByDingtalkTaskId('dt-1')).syncWriteback).toBe('none');
    // 第二轮：标记已清除，钉钉侧未完成 → 允许覆盖回 active
    ctx.client.listMyTasks
      .mockResolvedValueOnce([{ taskId: 'dt-1', subject: 'x', isDone: false, dueTime: null, bizTag: null }])
      .mockResolvedValueOnce([]);
    await ctx.service.syncFromDingtalk();
    expect((await ctx.repos.tasks.getByDingtalkTaskId('dt-1')).status).toBe('active');
  });
});
```

`server/app.test.js`：`makeApp` 处注入 stub service，并追加用例：

```js
// makeApp 修改（原有 repos 基础上追加）：
//   const todoSyncService = {
//     writebackStatus: vi.fn().mockResolvedValue(),
//   };
//   const app = createApp({ repos, todoSyncService });

describe('钉钉任务 PATCH 回写', () => {
  async function createDingtalkTask(repos, overrides = {}) {
    return repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: null, syncOrigin: null, syncWriteback: 'none', status: 'active',
      ...overrides,
    });
  }

  it('完成 → 触发 writebackStatus（status=completed）且本地状态更新', async () => {
    const t = await createDingtalkTask(ctx.repos);
    const res = await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(ctx.todoSyncService.writebackStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('取消完成 → 触发 writebackStatus（status=active）', async () => {
    const t = await createDingtalkTask(ctx.repos, { status: 'completed', completedAt: '2026-08-07T09:00:00.000Z' });
    const res = await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(ctx.todoSyncService.writebackStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });

  it('回写失败 → sync_writeback=pending，本地状态仍更新', async () => {
    const t = await createDingtalkTask(ctx.repos);
    ctx.todoSyncService.writebackStatus.mockRejectedValue(new Error('dws 不可用'));
    const res = await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.syncWriteback).toBe('pending');
  });

  it('本地任务 PATCH 不触发回写', async () => {
    const t = await ctx.repos.tasks.create({ title: '本地', important: false, urgent: false });
    await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ status: 'completed' });
    expect(ctx.todoSyncService.writebackStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- server/todoSync/todoSyncService.test.js server/app.test.js`

Expected: FAIL——`writebackStatus` / `retryWritebacks` 未实现，PATCH 未触发回写。

- [ ] **Step 3: 最小实现**

`server/todoSync/todoSyncService.js` 内追加（Task 3 已留调用点 `const writeback = await retryWritebacks();`）：

```js
/** 回写重试：sync_writeback=pending 的任务按本地当前状态调 task done，成功清除标记（无限重试）。 */
async function retryWritebacks() {
  const localList = await repos.tasks.list();
  let retried = 0;
  let pending = 0;
  for (const t of localList) {
    if (t.source !== 'dingtalk' || t.syncWriteback !== 'pending') continue;
    try {
      await client.setTaskDone({
        taskId: t.dingtalkTaskId,
        status: t.status === 'completed',
        profile,
      });
      await repos.tasks.setSyncWriteback(t.id, 'none');
      retried += 1;
    } catch {
      pending += 1; // 下次轮询继续重试，不设上限
    }
  }
  return { retried, pending };
}

/** PATCH 回写：钉钉任务完成/取消完成即时写钉钉，成功清除标记，失败抛出（由路由置 pending）。 */
async function writebackStatus({ task, status }) {
  if (task?.source !== 'dingtalk' || !task.dingtalkTaskId) return;
  if (status !== 'completed' && status !== 'active') return;
  await client.setTaskDone({
    taskId: task.dingtalkTaskId,
    status: status === 'completed',
    profile,
  });
  await repos.tasks.setSyncWriteback(task.id, 'none');
}
```

并在 return 中导出 `retryWritebacks`、`writebackStatus`。

`server/app.js` PATCH 处理器修改（在 `repos.tasks.update` 之前插入回写）：

```js
app.patch(
  '/api/tasks/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid task id' });
    const body = req.body || {};
    const existing = await repos.tasks.get(id);
    if (!existing) return res.status(404).json({ error: 'Not Found' });
    if (existing.source === 'dingtalk') {
      // 标题锁定：忽略 title；四象限锁定：忽略 important/urgent（同步时服务端强制 1）
      delete body.title;
      delete body.important;
      delete body.urgent;
    }
    const check = validateTaskPatch(body);
    if (check.error) return res.status(400).json({ error: check.error });
    // 即时回写：完成/取消完成双向对称；失败置 pending（本地状态照常更新，乐观生效）
    if (existing.source === 'dingtalk' && 'status' in check.value) {
      try {
        await todoSyncService.writebackStatus({ task: existing, status: check.value.status });
      } catch {
        await repos.tasks.setSyncWriteback(id, 'pending');
      }
    }
    const task = await repos.tasks.update(id, check.value);
    res.json(task);
  })
);
```

- [ ] **Step 4: 验证通过**

Run: `npm test -- server/todoSync/todoSyncService.test.js server/app.test.js`

Expected: PASS（回写触发/失败置 pending/重试清除/pending 保护全部通过）。

- [ ] **Step 5: 提交**

```bash
git add server/todoSync/todoSyncService.js server/todoSync/todoSyncService.test.js server/app.js server/app.test.js
git commit -m "feat: writeback task status to dingtalk with pending retry"
```

---

### Task 7: Locking + DELETE Block + Fail-Fast 配置

**Files:**
- Modify: `server/app.js`（DELETE `/api/tasks/:id` 拒绝钉钉来源任务 403；PATCH 忽略 title/important/urgent——Task 6 已含忽略逻辑，本步补充「全部字段被忽略后返回现状」分支）
- Test: `server/app.test.js`（追加「钉钉任务锁定」describe 块：DELETE 403、PATCH 忽略、GET 返回新字段）
- Modify: `server/index.js`：fail-fast 检查已在 Task 5 装配；本步仅校验（grep），无新代码

**Interfaces:**
- Consumes: `repos.tasks.get` / `softDelete`；Task 5 的 `createApp` 注入
- Produces:
  - `DELETE /api/tasks/:id`：`source='dingtalk'` → `403 { error: '钉钉同步任务不可删除' }`；本地任务行为不变
  - `PATCH /api/tasks/:id`：钉钉任务忽略 `title`/`important`/`urgent`；锁定字段被忽略后 body 为空 → `200` 返回现状（幂等）
  - `GET /api/tasks`：响应含 `source/sourceLeader/dueTime/dingtalkTaskId/syncWriteback`（Task 1 的 `mapTask` 已输出，本步仅测试验证）
  - `server/index.js`：未配置 `DINGTALK_TODO_PROFILE` 时启动打印错误，同步接口返回 503，其他服务正常（Task 5 已实现）

- [ ] **Step 1: 写失败测试**

`server/app.test.js` 追加：

```js
describe('钉钉任务锁定', () => {
  it('DELETE 钉钉来源任务 → 403，且未被软删', async () => {
    const t = await ctx.repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: null, syncOrigin: null, syncWriteback: 'none', status: 'active',
    });
    const res = await request(ctx.app).delete(`/api/tasks/${t.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('钉钉同步任务不可删除');
    expect((await ctx.repos.tasks.get(t.id)).status).toBe('active');
  });

  it('本地任务仍可删除', async () => {
    const t = await ctx.repos.tasks.create({ title: '本地', important: false, urgent: false });
    const res = await request(ctx.app).delete(`/api/tasks/${t.id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('deleted');
  });

  it('PATCH 钉钉任务忽略 title/important/urgent（强制锁定）', async () => {
    const t = await ctx.repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    const res = await request(ctx.app)
      .patch(`/api/tasks/${t.id}`)
      .send({ title: '篡改标题', important: false, urgent: false, status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('领导任务');
    expect(res.body.important).toBe(true);
    expect(res.body.urgent).toBe(true);
    expect(res.body.status).toBe('completed'); // 状态字段仍生效（回写由 Task 6 处理）
  });

  it('PATCH 钉钉任务只传锁定字段 → 200 返回现状（幂等）', async () => {
    const t = await ctx.repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    const res = await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ title: '篡改标题' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('领导任务');
  });

  it('GET /api/tasks 返回同步字段（camelCase）', async () => {
    await ctx.repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: '2026-08-08T10:00:00.000Z', syncOrigin: 'certify_todo',
      syncWriteback: 'pending', status: 'active',
    });
    const res = await request(ctx.app).get('/api/tasks');
    expect(res.body[0]).toMatchObject({
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: '2026-08-08T10:00:00.000Z', syncOrigin: 'certify_todo', syncWriteback: 'pending',
    });
  });
});
```

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- server/app.test.js`

Expected: FAIL——DELETE 未拒绝钉钉任务；PATCH 忽略后空 body 返回 400。

- [ ] **Step 3: 最小实现**

`server/app.js` DELETE 处理器替换为：

```js
app.delete(
  '/api/tasks/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid task id' });
    const task = await repos.tasks.get(id);
    if (!task) return res.status(404).json({ error: 'Not Found' });
    if (task.source === 'dingtalk') {
      return res.status(403).json({ error: '钉钉同步任务不可删除' });
    }
    res.json(await repos.tasks.softDelete(id));
  })
);
```

PATCH 处理器在 `validateTaskPatch` 之后追加幂等分支（Task 6 已加入忽略逻辑）：

```js
const check = validateTaskPatch(body);
// 钉钉任务：锁定字段被忽略后无剩余字段 → 幂等返回现状（不报 400）
if (check.error && existing.source === 'dingtalk' && Object.keys(body).length === 0) {
  return res.json(existing);
}
if (check.error) return res.status(400).json({ error: check.error });
```

`server/index.js` 校验（fail-fast 已由 Task 5 装配，确认存在）：

```bash
git grep -n "DINGTALK_TODO_PROFILE" server/index.js
```

Expected: 输出 Task 5 的检查块（`if (!dingtalkTodoProfile) console.error(...)`）；且该块不含 `process.exit`（其他服务正常）。

- [ ] **Step 4: 验证通过**

Run: `npm test -- server/app.test.js && npm test -- server/`

Expected: PASS（app 测试 + 全部后端测试）。

- [ ] **Step 5: 提交**

```bash
git add server/app.js server/app.test.js
git commit -m "feat: lock dingtalk tasks against delete and quadrant/title edits"
```

---

### Task 8: 前端 API Client 同步集成

**Files:**
- Modify: `src/api/client.js`（任务函数区追加 `syncTodos` / `getTodoSyncStatus`）
- Test: `src/api/client.test.js`（新建，mock 全局 fetch 验证 endpoint 与 method）

**Interfaces:**
- Consumes: 现有 `request()` 封装（统一 JSON + 15s 超时 + 非 2xx 抛错）
- Produces:
  - `syncTodos()` → `POST /api/todo-sync` → `{ syncedAt, imported, updated, softDeleted, writeback }`（节流内返回缓存结果；`inFlight` 时为 `202 { inFlight: true }`）
  - `getTodoSyncStatus()` → `GET /api/todo-sync` → `{ syncedAt, lastResult, profile, inFlight, configured }`
  - `updateTask(id, patch)` 不变：含 `status=completed/active` 时后端自动触发回写，客户端只做乐观更新
  - `deleteTask(id)` 不变：删除前由 UI 层按 `source` 判断（见 Task 9）

- [ ] **Step 1: 写失败测试**

`src/api/client.test.js`：

```js
// 客户端 API 封装测试：mock 全局 fetch，验证 todo-sync 相关 endpoint。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { syncTodos, getTodoSyncStatus } from './client'

function stubFetch(status, body) {
  return vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('syncTodos', () => {
  it('调用 POST /api/todo-sync 并返回结果', async () => {
    const body = {
      syncedAt: '2026-08-07T12:00:00.000Z',
      imported: 3,
      updated: 5,
      softDeleted: 1,
      writeback: { retried: 2, pending: 0 },
    }
    const fetchMock = stubFetch(200, body)
    const result = await syncTodos()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/todo-sync',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.imported).toBe(3)
  })

  it('inFlight 响应透传 { inFlight: true }', async () => {
    const fetchMock = stubFetch(202, { inFlight: true })
    const result = await syncTodos()
    expect(result).toEqual({ inFlight: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('非 2xx 抛出后端 error', async () => {
    stubFetch(503, { error: 'DINGTALK_TODO_PROFILE 未配置' })
    await expect(syncTodos()).rejects.toThrow('DINGTALK_TODO_PROFILE 未配置')
  })
})

describe('getTodoSyncStatus', () => {
  it('调用 GET /api/todo-sync（无 method）', async () => {
    const body = { syncedAt: null, lastResult: null, profile: 'corp:user', inFlight: false, configured: true }
    const fetchMock = stubFetch(200, body)
    const result = await getTodoSyncStatus()
    expect(fetchMock).toHaveBeenCalledWith('/api/todo-sync', expect.any(Object))
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
    expect(result.profile).toBe('corp:user')
  })
})
```

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- src/api/client.test.js`

Expected: FAIL——`syncTodos` / `getTodoSyncStatus` 未导出。

- [ ] **Step 3: 最小实现**

`src/api/client.js` 任务区末尾追加：

```js
// POST /api/todo-sync（手动触发同步；服务端 <2 分钟节流时返回缓存结果）
export function syncTodos() {
  return request('/todo-sync', { method: 'POST' })
}

// GET /api/todo-sync → { syncedAt, lastResult, profile, inFlight, configured }
export function getTodoSyncStatus() {
  return request('/todo-sync')
}
```

`updateTask` / `deleteTask` 保持不变——PATCH 含 `status` 时后端自动回写钉钉（Task 6）；删除的 source 判断在 UI 层（Task 9）。

- [ ] **Step 4: 验证通过**

Run: `npm test -- src/api/client.test.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/api/client.js src/api/client.test.js
git commit -m "feat: add todo sync api client functions"
```

---

### Task 9: TodoItem + QuadrantCell 同步展示

**Files:**
- Modify: `src/components/TodoItem.jsx`（来源领导徽标、截止时间、pending 标记、钉钉任务不渲染删除按钮）
- Modify: `src/components/TodoView.jsx:13-23`（`normalizeTask` 透传 `source/sourceLeader/dueTime/dingtalkTaskId/syncWriteback`）
- Modify: `src/styles/components.css`（新增 `.source-leader` / `.due-time` / `.sync-pending` 样式）
- Test: `src/components/TodoItem.test.jsx`（新建）
- Test: `src/components/QuadrantView.test.jsx`（追加「钉钉任务固定在重要·紧急格」用例）

**Interfaces:**
- Consumes: Task 1 的 task 字段（`source` / `sourceLeader` / `dueTime` / `dingtalkTaskId` / `syncWriteback`，前端 camelCase）；现有 `TaskTimerControls`
- Produces: `TodoItem` / `QuadrantCell` 渲染增强；`normalizeTask` 透传新字段；CSS 类 `.source-leader` / `.due-time` / `.sync-pending`

- [ ] **Step 1: 写失败测试**

`src/components/TodoItem.test.jsx`：

```jsx
import { render, screen } from '@testing-library/react'
import TodoItem from './TodoItem'

function renderItem(overrides = {}) {
  const todo = {
    id: 1,
    text: '领导任务',
    done: false,
    important: true,
    urgent: true,
    source: 'dingtalk',
    sourceLeader: '闫佳琪',
    dueTime: '2026-08-08T10:00:00.000Z',
    dingtalkTaskId: 'dt-1',
    syncWriteback: 'none',
    ...overrides,
  }
  return render(
    <TodoItem
      todo={todo}
      summary={null}
      onToggle={() => {}}
      onDelete={() => {}}
      timerCallbacks={{}}
    />,
  )
}

it('钉钉任务：渲染来源领导徽标与截止时间，无删除按钮', () => {
  renderItem()
  expect(screen.getByText('来自 闫佳琪')).toBeInTheDocument()
  expect(screen.getByText(/截止/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
})

it('本地任务：保留删除按钮，无来源徽标/截止时间', () => {
  renderItem({ source: 'local', sourceLeader: null, dueTime: null, dingtalkTaskId: null })
  expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  expect(screen.queryByText(/来自/)).not.toBeInTheDocument()
  expect(screen.queryByText(/截止/)).not.toBeInTheDocument()
})

it('syncWriteback=pending 显示「同步失败待重试」标记', () => {
  renderItem({ syncWriteback: 'pending' })
  expect(screen.getByText('同步失败待重试')).toBeInTheDocument()
})

it('钉钉任务无标题编辑控件（标题锁定由后端 PATCH 忽略保证）', () => {
  renderItem()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('来源领导缺失（task get 失败）时不渲染徽标', () => {
  renderItem({ sourceLeader: null })
  expect(screen.queryByText(/来自/)).not.toBeInTheDocument()
})
```

`src/components/QuadrantView.test.jsx` 追加：

```jsx
it('钉钉来源任务显示在「重要·紧急」格', () => {
  const todos = [
    {
      id: 1, text: '领导任务', done: false, important: true, urgent: true,
      source: 'dingtalk', sourceLeader: '闫佳琪', dueTime: null,
      dingtalkTaskId: 'dt-1', syncWriteback: 'none',
    },
    { id: 2, text: '本地任务', done: false, important: false, urgent: false, source: 'local' },
  ]
  render(
    <QuadrantView
      todos={todos}
      onToggle={() => {}}
      onDelete={() => {}}
      timerCallbacks={{}}
      getTodoSummary={() => null}
    />,
  )
  const cell = screen.getByTestId('quadrant-important-urgent')
  expect(within(cell).getByText('领导任务')).toBeInTheDocument()
  expect(within(cell).getByText('来自 闫佳琪')).toBeInTheDocument()
})
```

（`within` 从 `@testing-library/react` 导入；文件顶部 import 同步补充。）

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- src/components/TodoItem.test.jsx src/components/QuadrantView.test.jsx`

Expected: FAIL——徽标/截止时间/pending 标记未渲染，钉钉任务仍显示删除按钮。

- [ ] **Step 3: 最小实现**

`src/components/TodoItem.jsx` 替换为：

```jsx
import { getQuadrantKey, QUADRANTS } from '../lib/quadrants'
import TaskTimerControls from './TaskTimerControls'

function formatDueTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TodoItem({
  todo,
  summary,
  onToggle,
  onDelete,
  timerCallbacks,
}) {
  const quadrantKey = getQuadrantKey(todo.important, todo.urgent)
  const quadrant = QUADRANTS[quadrantKey]
  const isDingtalk = todo.source === 'dingtalk'
  return (
    <li className={`todo-item${todo.done ? ' is-done' : ''}`} data-quadrant={quadrantKey}>
      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => onToggle(todo.id)}
        aria-label="标记完成"
      />
      <span className="todo-text">{todo.text}</span>
      {isDingtalk && todo.sourceLeader && (
        <span className="source-leader">来自 {todo.sourceLeader}</span>
      )}
      {todo.dueTime && <span className="due-time">截止 {formatDueTime(todo.dueTime)}</span>}
      {isDingtalk && todo.syncWriteback === 'pending' && (
        <span className="sync-pending" title="钉钉回写失败，等待下次同步重试">
          同步失败待重试
        </span>
      )}
      <span className="todo-quadrant-tag">{quadrant.title}</span>
      <TaskTimerControls
        summary={summary}
        onStart={(track) => timerCallbacks.start(todo.id, track)}
        onPause={(track) => timerCallbacks.pause(todo.id, track)}
        onResume={(track) => timerCallbacks.resume(todo.id, track)}
        onStop={(track) => timerCallbacks.stop(todo.id, track)}
        disabled={todo.done}
      />
      {/* 钉钉来源任务不可删除（后端 DELETE 亦拒绝，双保险）；计时不受影响 */}
      {!isDingtalk && (
        <button type="button" onClick={() => onDelete(todo.id)}>
          删除
        </button>
      )}
    </li>
  )
}
```

`src/components/TodoView.jsx` 的 `normalizeTask` 追加透传：

```js
function normalizeTask(task) {
  return {
    id: task.id,
    text: task.title,
    done: task.status === 'completed',
    important: Boolean(task.important),
    urgent: Boolean(task.urgent),
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    source: task.source ?? 'local',
    sourceLeader: task.sourceLeader ?? null,
    dueTime: task.dueTime ?? null,
    dingtalkTaskId: task.dingtalkTaskId ?? null,
    syncWriteback: task.syncWriteback ?? 'none',
  }
}
```

`src/styles/components.css` 末尾追加：

```css
/* 钉钉同步任务：来源领导徽标 / 截止时间 / 同步失败待重试 */
.source-leader {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 122, 255, 0.12);
  color: #2f6fed;
  font-size: 12px;
}
.due-time {
  margin-left: 8px;
  font-size: 12px;
  color: var(--muted, #8a8f98);
}
.sync-pending {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 153, 0, 0.15);
  color: #b26a00;
  font-size: 12px;
}
```

（若 theme.css 已有 `--muted` 变量则 `var(--muted)` 生效，否则用 fallback 值，不新增主题变量。）

- [ ] **Step 4: 验证通过**

Run: `npm test -- src/components/TodoItem.test.jsx src/components/QuadrantView.test.jsx src/components/TodoView.test.jsx`

Expected: PASS（新增展示用例 + 既有 TodoView 测试不回归）。

- [ ] **Step 5: 提交**

```bash
git add src/components/TodoItem.jsx src/components/TodoView.jsx src/styles/components.css src/components/TodoItem.test.jsx src/components/QuadrantView.test.jsx
git commit -m "feat: show dingtalk source badge, due time and pending marker"
```

---

### Task 10: TodoView 同步按钮

**Files:**
- Modify: `src/components/TodoView.jsx`（顶部同步按钮 + 上次同步时间 + idle/syncing/success/failed 状态 + 页面加载触发一次同步）
- Modify: `src/components/TodoView.test.jsx`（apiMocks 增加 `syncTodos`/`getTodoSyncStatus`；追加同步按钮用例）
- Modify: `src/styles/components.css`（新增 `.todo-sync-bar` / `.todo-sync-last` / `.sync-message`）

**Interfaces:**
- Consumes: Task 8 的 `syncTodos()` / `getTodoSyncStatus()`；现有 `normalizeTask`（Task 9 已透传新字段）
- Produces: `TodoView` 新增 state `syncState`（idle|syncing|success|failed）、`syncMessage`、`lastSyncAt`；mount 时静默触发 `syncTodos()`（服务端 <2 分钟节流）；按钮点击触发并展示结果

- [ ] **Step 1: 写失败测试**

`src/components/TodoView.test.jsx` 修改：

```js
// apiMocks（vi.hoisted 内）追加：
//   syncTodos: vi.fn(),
//   getTodoSyncStatus: vi.fn(),
// installApiDefaults 内追加默认实现：
//   apiMocks.syncTodos.mockResolvedValue({
//     syncedAt: '2026-08-07T12:00:00.000Z', imported: 0, updated: 0,
//     softDeleted: 0, writeback: { retried: 0, pending: 0 },
//   })
//   apiMocks.getTodoSyncStatus.mockResolvedValue({
//     syncedAt: null, lastResult: null, profile: 'corp:user', inFlight: false, configured: true,
//   })
```

追加用例：

```jsx
it('点击同步按钮触发 syncTodos 并显示成功信息', async () => {
  render(<TodoView />)
  apiMocks.syncTodos.mockResolvedValue({
    syncedAt: '2026-08-07T12:00:00.000Z', imported: 3, updated: 5,
    softDeleted: 0, writeback: { retried: 0, pending: 0 },
  })
  await userEvent.setup().click(screen.getByRole('button', { name: /同步钉钉待办/ }))
  expect(apiMocks.syncTodos).toHaveBeenCalled()
  expect(await screen.findByText('同步成功，导入 3 / 更新 5')).toBeInTheDocument()
})

it('同步中显示 loading 态（按钮禁用）', async () => {
  let resolve
  apiMocks.syncTodos.mockImplementation(
    () => new Promise((r) => { resolve = r }),
  )
  render(<TodoView />)
  const btn = screen.getByRole('button', { name: /同步钉钉待办/ })
  await userEvent.setup().click(btn)
  expect(btn).toBeDisabled()
  expect(screen.getByText(/同步中/)).toBeInTheDocument()
  resolve({
    syncedAt: '2026-08-07T12:00:00.000Z', imported: 0, updated: 0,
    softDeleted: 0, writeback: { retried: 0, pending: 0 },
  })
})

it('同步失败显示错误提示且不阻塞本地操作', async () => {
  render(<TodoView />)
  apiMocks.syncTodos.mockRejectedValue(new Error('钉钉同步失败，请稍后重试'))
  await userEvent.setup().click(screen.getByRole('button', { name: /同步钉钉待办/ }))
  expect(await screen.findByText('钉钉同步失败，请稍后重试')).toBeInTheDocument()
  // 本地勾选仍可用
  const checkbox = screen.getAllByRole('checkbox')[0]
  await userEvent.setup().click(checkbox)
  expect(apiMocks.updateTask).toHaveBeenCalled()
})

it('显示上次同步时间', async () => {
  apiMocks.getTodoSyncStatus.mockResolvedValue({
    syncedAt: '2026-08-07T12:00:00.000Z', lastResult: null,
    profile: 'corp:user', inFlight: false, configured: true,
  })
  render(<TodoView />)
  expect(await screen.findByText(/上次同步/)).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行并验证失败**

Run: `npm test -- src/components/TodoView.test.jsx`

Expected: FAIL——「同步钉钉待办」按钮不存在；现有用例因 `syncTodos` 未 mock 而报错（mount 触发）。

- [ ] **Step 3: 最小实现**

`src/components/TodoView.jsx` 修改：

```jsx
// import 追加：
import { getTasks, createTask, updateTask, deleteTask, syncTodos, getTodoSyncStatus } from '../api/client'

// state 追加：
const [syncState, setSyncState] = useState('idle') // idle | syncing | success | failed
const [syncMessage, setSyncMessage] = useState('')
const [lastSyncAt, setLastSyncAt] = useState(null)

function formatSyncTime(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN')
}

// 页面加载触发一次同步（服务端 <2 分钟节流，成功静默）；读取上次同步时间；失败仅提示不阻塞。
useEffect(() => {
  let cancelled = false
  syncTodos().catch(() => {
    if (!cancelled) setSyncState('failed')
  })
  getTodoSyncStatus()
    .then((s) => {
      if (!cancelled && s?.syncedAt) setLastSyncAt(s.syncedAt)
    })
    .catch(() => {})
  return () => {
    cancelled = true
  }
}, [])

function handleSync() {
  setSyncState('syncing')
  setSyncMessage('')
  syncTodos()
    .then((r) => {
      setSyncState('success')
      if (r?.inFlight) {
        setSyncMessage('已有同步正在进行')
      } else {
        setSyncMessage(`同步成功，导入 ${r?.imported ?? 0} / 更新 ${r?.updated ?? 0}`)
        if (r?.syncedAt) setLastSyncAt(r.syncedAt)
      }
    })
    .catch(() => {
      setSyncState('failed')
      setSyncMessage('钉钉同步失败，请稍后重试')
    })
}
```

JSX 在 `<TodoViewToggle>` 之后插入：

```jsx
<div className="todo-sync-bar">
  <button type="button" onClick={handleSync} disabled={syncState === 'syncing'}>
    {syncState === 'syncing' ? '同步中…' : '同步钉钉待办'}
  </button>
  {lastSyncAt && <span className="todo-sync-last">上次同步：{formatSyncTime(lastSyncAt)}</span>}
</div>
{syncState === 'success' && syncMessage && (
  <p className="sync-message" role="status">
    {syncMessage}
  </p>
)}
{syncState === 'failed' && (
  <p className="save-error" role="alert">
    {syncMessage}
  </p>
)}
```

`src/styles/components.css` 末尾追加：

```css
/* 待办视图：钉钉同步按钮与状态 */
.todo-sync-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.todo-sync-last {
  font-size: 12px;
  color: var(--muted, #8a8f98);
}
.sync-message {
  color: #2f9e44;
  font-size: 13px;
}
```

- [ ] **Step 4: 验证通过**

Run: `npm test -- src/components/TodoView.test.jsx`

Expected: PASS（新增 4 个用例 + 既有用例；mount 触发同步被默认 mock 吸收）。

- [ ] **Step 5: 提交**

```bash
git add src/components/TodoView.jsx src/components/TodoView.test.jsx src/styles/components.css
git commit -m "feat: add dingtalk sync button and status to todo view"
```

---

### Task 11: 配置 + 日报来源统计 + 验收

**Files:**
- Modify: `.env.example`（追加 `DINGTALK_TODO_PROFILE` / `DINGTALK_TODO_SYNC_CRON`）
- Modify: `.env`（追加两行：工作组织 profile + cron 默认）
- Modify: `package.json`（校验 `p-limit` 依赖——Task 3 已安装并提交；本步确认无遗漏）
- Modify: `server/services/reportService.js`（`buildReportSource` 的 `withDuration` 附带 `source`/`sourceLeader`；`buildDifyInputs` 的 `withTime` 附带 `source`/`source_leader`）
- Modify: `src/components/report/ReportSourceSummary.jsx`（「含钉钉任务 N 条」最小统计——spec §8 标记可选，取最小版本）
- Test: `server/services/reportService.test.js`（追加 source 字段断言）
- Test: `src/components/report/ReportSourceSummary.test.jsx`（新建，最小）

**Interfaces:**
- Consumes: Task 1 的 task 字段（`source`/`sourceLeader`）；spec §7 日报口径
- Produces: `buildReportSource` 的 completed/pending todo 附带 `source`/`sourceLeader`；Dify inputs 附带 `source`/`source_leader`；`ReportSourceSummary` 展示钉钉来源数量；`.env`/`.env.example` 两变量

- [ ] **Step 1: 配置与依赖**

`.env.example` 末尾追加：

```
# 钉钉待办同步：来源组织 profile（corpId:userId 格式，必须显式配置，未配置同步 fail-fast 报错）
DINGTALK_TODO_PROFILE=ding4108cf4d27f89345acaaa37764f94726:17857219403578277
# 钉钉待办拉取轮询 cron（默认每 30 分钟）
DINGTALK_TODO_SYNC_CRON=*/30 * * * *
```

`.env` 追加两行（工作组织 profile，与 spec §12 默认一致）：

```
DINGTALK_TODO_PROFILE=ding4108cf4d27f89345acaaa37764f94726:17857219403578277
DINGTALK_TODO_SYNC_CRON=*/30 * * * *
```

校验 p-limit（Task 3 已安装）：

```bash
npm ls p-limit
```

Expected: `p-limit@^6.x` 已安装（package.json dependencies 含 `"p-limit": "^6.0.0"`）。

- [ ] **Step 2: 写失败测试**

`server/services/reportService.test.js` 追加：

```js
it('buildReportSource 附带 source/sourceLeader', async () => {
  const repos = createInMemoryRepos();
  await repos.tasks.create({
    title: '领导任务', important: true, urgent: true,
    dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
    status: 'completed', completedAt: '2026-08-07T09:00:00.000Z', syncWriteback: 'none',
  });
  const source = await buildReportSource(repos, { date: '2026-08-07' });
  expect(source.completedTodos[0]).toMatchObject({ source: 'dingtalk', sourceLeader: '闫佳琪' });
});
```

`src/components/report/ReportSourceSummary.test.jsx`（新建）：

```jsx
import { render, screen } from '@testing-library/react'
import ReportSourceSummary from './ReportSourceSummary'

it('展示钉钉来源任务数量', () => {
  const source = {
    completedTodos: [{ id: 1, source: 'dingtalk' }, { id: 2, source: 'local' }],
    pendingTodos: [{ id: 3, source: 'dingtalk' }],
    totalHumanMs: 0,
    totalAgentMs: 0,
  }
  render(<ReportSourceSummary source={source} />)
  expect(screen.getByText('含钉钉任务 2 条')).toBeInTheDocument()
})

it('无钉钉任务时不显示统计', () => {
  const source = {
    completedTodos: [],
    pendingTodos: [{ id: 1, source: 'local' }],
    totalHumanMs: 0,
    totalAgentMs: 0,
  }
  render(<ReportSourceSummary source={source} />)
  expect(screen.queryByText(/含钉钉任务/)).not.toBeInTheDocument()
})
```

- [ ] **Step 3: 运行并验证失败**

Run: `npm test -- server/services/reportService.test.js src/components/report/ReportSourceSummary.test.jsx`

Expected: FAIL——`buildReportSource` 未附带 source 字段；`ReportSourceSummary` 无统计行。

- [ ] **Step 4: 最小实现**

`server/services/reportService.js` 的 `withDuration` 返回值追加：

```js
const withDuration = (t) => {
  const a = agg.get(t.id) || { humanMs: 0, agentMs: 0 };
  return {
    id: t.id,
    title: t.title || '已删除任务',
    important: !!t.important,
    urgent: !!t.urgent,
    source: t.source ?? 'local',
    sourceLeader: t.sourceLeader ?? null,
    humanMs: a.humanMs,
    agentMs: a.agentMs,
  };
};
```

`buildDifyInputs` 的 `withTime` 追加（Dify 变量附带 source / source_leader，spec §7）：

```js
const withTime = (t) => ({
  ...t,
  source: t.source ?? 'local',
  source_leader: t.sourceLeader ?? null,
  humanTime: formatDuration(t.humanMs),
  agentTime: formatDuration(t.agentMs),
  totalTime: formatDuration((t.humanMs || 0) + (t.agentMs || 0)),
});
```

`src/components/report/ReportSourceSummary.jsx`：

```jsx
// 日报数据源摘要：展示所选日期下已完成/未完成的任务数量，以及人工/AI 双轨总时长。
function formatMs(ms) {
  const totalMinutes = Math.round(Number(ms) / 60000)
  if (Number.isNaN(totalMinutes) || totalMinutes < 0) return '0分钟'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}小时${minutes}分钟`
  return `${minutes}分钟`
}

export default function ReportSourceSummary({ source }) {
  const total = source.completedTodos.length + source.pendingTodos.length
  const dingtalkCount =
    source.completedTodos.filter((t) => t.source === 'dingtalk').length +
    source.pendingTodos.filter((t) => t.source === 'dingtalk').length
  return (
    <div className="report-source-summary">
      <p>
        当天共 {total} 个任务，已完成 {source.completedTodos.length} 个，未完成{' '}
        {source.pendingTodos.length} 个
      </p>
      {dingtalkCount > 0 && <p>含钉钉任务 {dingtalkCount} 条</p>}
      <p>
        双轨总时长：人工 {formatMs(source.totalHumanMs)}，AI{' '}
        {formatMs(source.totalAgentMs)}
      </p>
    </div>
  )
}
```

- [ ] **Step 5: 验证通过**

Run: `npm test && npm run build`

Expected: 全部前端 + 后端测试 PASS，生产构建成功。

- [ ] **Step 6: 手动验收 checklist（对应 spec §11 手动验收 7 项）**

```text
1. 笔记本启动全链路，配置 DINGTALK_TODO_PROFILE（工作组织）
2. 钉钉侧创建一条指派给本人（齐浩南）的待办 → 页面加载/点同步 → prodash 出现该任务，锁定「重要·紧急」，徽标显示来源领导
3. prodash 勾选完成 → 钉钉侧该待办变为已完成；取消勾选 → 钉钉侧恢复未完成
4. 钉钉侧标记另一任务完成 → 轮询后 prodash 显示已完成，且以发现时刻补写 completed_at 计入当日完成
5. 钉钉侧删除任务 → 连续 2 次轮询后 prodash 软删该任务
6. prodash 中钉钉任务无删除按钮、标题不可编辑；直接调 DELETE 返回 403
7. 未配置 DINGTALK_TODO_PROFILE 启动 → 同步 fail-fast 报错（启动日志报错 + POST /api/todo-sync 返回 503，其他服务正常）
```

另：手工验收时用 `dws todo +get-my-tasks --profile <profile> --format json` 实际输出核对 `mapTodoItem`/`extractListPayload` 的字段名（客户端已做驼峰/下划线别名容错；若真实字段名不符，仅需调整 `pick` 的候选键，不涉及 schema/路由）。

- [ ] **Step 7: 提交**

```bash
git add .env.example .env server/services/reportService.js server/services/reportService.test.js src/components/report/ReportSourceSummary.jsx src/components/report/ReportSourceSummary.test.jsx
git commit -m "feat: add dingtalk sync env config and report source stats"
```

---

## Implementation Order

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11。

依赖关系说明：

- Task 1（schema/repos）是全部后端任务的地基；Task 2（DwsTodoClient）独立；Task 3（service upsert）依赖 1+2+p-limit；Task 4（软删/节流/互斥）与 Task 6（回写重试）都在 Task 3 的同一文件中增量扩展。
- Task 5（路由/调度/index 装配）依赖 2+3+4；Task 6（PATCH 回写）依赖 3+5（`createApp` 注入）；Task 7（锁定）依赖 6（同一 PATCH 处理器）与 Task 1（GET 字段）。
- 前端 Task 8（client）依赖后端 API 契约（Task 5/6/7 定稿）；Task 9（TodoItem/QuadrantCell）依赖 Task 1 的字段与 Task 8 的 client；Task 10（TodoView 按钮）依赖 Task 8+9（normalizeTask 透传）。
- Task 11（配置/日报统计/验收）依赖全部后端 + 前端任务；`p-limit` 依赖已在 Task 3 安装并随其提交，Task 11 仅校验与登记文档。

每个 Task 独立可提交（commit message 见各 Task Step 5）；Task 4 在 Task 3 提交后紧随，二者共享同一 service 文件但提交点分离，保证每步测试全绿。
