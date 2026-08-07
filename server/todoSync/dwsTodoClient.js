// 钉钉待办 dws CLI 客户端（读 + 写）。
// 与 DwsCliPublisher 同源调用模式：execFile(node.exe, dws.js, args)，非 shell 拼接；
// 所有输出经 parseDwsJson 容错（整体 JSON.parse 失败则取首个 { 到末尾 }）。
// profile 显式传 --profile（spec §6.3：不依赖 dws 全局默认 profile），缺失即 fail-fast 抛错。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60000;
// dws 实测：--size 超过 20 时静默返回空列表（count:0），仅 20（默认）可靠 → 固定用 20。
const DEFAULT_PAGE_SIZE = 20;
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

/** 从列表响应中 lenient 提取 { items, hasMore }（兼容 data.list / data.items / 根级 list / todos）。 */
export function extractListPayload(root) {
  const data = root?.data && typeof root.data === 'object' ? root.data : root;
  const raw = data?.list ?? data?.items ?? data?.result ?? data?.todos ?? root?.list ?? root?.todos ?? [];
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
        '--status', status === 'completed' ? 'true' : 'false', // dws 期望布尔值（true=done, false=todo）
        '--size', String(pageSize),
        '--page', String(page),
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
    // dws 详情真实结构：{ success, result: { todoDetailModel: { creatorInfo, ... } } }
    const detail =
      data?.task ?? data?.detail ?? data?.todo ?? data?.result?.todoDetailModel ?? data?.result ?? data;
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
