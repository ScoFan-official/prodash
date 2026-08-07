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

  it('extractListPayload 兼容 dws +get-my-tasks 实际返回（根级 todos）', () => {
    expect(extractListPayload({ count: 1, todos: [{ taskId: '55949145596', subject: 'A' }] }))
      .toEqual({ items: [{ taskId: '55949145596', subject: 'A' }], hasMore: false });
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
      'todo', '+get-my-tasks', '--role-types', 'executor', '--status', 'false',
      '--size', '20', '--page', '1',
      '--profile', 'corp:user', '--format', 'json',
    ]));
    expect(execFile.mock.calls[1][1]).toContain('--page');
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

  it('兼容 dws 真实详情结构 result.todoDetailModel（含 creatorInfo）', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        success: true,
        result: {
          todoDetailModel: {
            subject: '真实结构任务',
            creatorInfo: { name: '齐浩南', userId: 260593855 },
            dueTime: 1786096800000,
            executorInfos: [],
            isDone: false,
            priority: 30,
            bizTag: 'teambition',
            source: 'teambition',
          },
        },
      }),
    });
    const client = makeClient(execFile);
    const detail = await client.getTaskDetail({ taskId: 'dt-2' });
    expect(detail).toMatchObject({
      subject: '真实结构任务',
      creatorInfo: { name: '齐浩南', userId: 260593855 },
      isDone: false,
      bizTag: 'teambition',
      source: 'teambition',
    });
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
