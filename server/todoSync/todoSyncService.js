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

  /** 占位实现（Task 4 替换）：软删本轮未见到的钉钉任务。 */
  async function softDeleteIfGone({ seenIds }) {
    return 0;
  }

  /** 占位实现（Task 6 替换）：重试 pending 回写。 */
  async function retryWritebacks() {
    return { retried: 0, pending: 0 };
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
