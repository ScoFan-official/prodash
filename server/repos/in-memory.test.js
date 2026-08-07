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
