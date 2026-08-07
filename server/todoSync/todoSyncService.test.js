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
