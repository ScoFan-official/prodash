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
      .mockResolvedValueOnce([]) // 第一轮：未见到 dt-x（进入候选集）
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ taskId: 'dt-x', subject: 'x', isDone: false, dueTime: null, bizTag: null }]); // 第二轮：重新出现
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
    // 重试迭代顺序与 in-memory list 的 id 降序相关；用 taskId 决定成败，避免顺序依赖
    ctx.client.setTaskDone.mockImplementation(async ({ taskId }) => {
      if (taskId === 'dt-a') return {};
      throw new Error('boom');
    });
    const result = await ctx.service.syncFromDingtalk();
    expect(result.writeback).toEqual({ retried: 1, pending: 1 });
    expect((await ctx.repos.tasks.getByDingtalkTaskId('dt-a')).syncWriteback).toBe('none');
    expect((await ctx.repos.tasks.getByDingtalkTaskId('dt-b')).syncWriteback).toBe('pending');
    expect(ctx.client.setTaskDone).toHaveBeenCalledWith({ taskId: 'dt-a', status: true, profile: 'corp:user' });
    expect(ctx.client.setTaskDone).toHaveBeenCalledWith({ taskId: 'dt-b', status: false, profile: 'corp:user' });
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
