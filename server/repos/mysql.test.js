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
