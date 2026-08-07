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
    if (task.status === status) return; // 状态无变化不写钉钉（active→active 等）
    await client.setTaskDone({
      taskId: task.dingtalkTaskId,
      status: status === 'completed',
      profile,
    });
    await repos.tasks.setSyncWriteback(task.id, 'none');
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
    // 已存在但本地缺来源领导的任务：补取详情（详情失败留空不阻塞），复用并发限 5。
    const missingLeaderTargets = items.filter((i) => {
      const local = byDingtalkId.get(i.taskId);
      return local && !local.sourceLeader;
    });
    const leaderDetails = await Promise.all(
      missingLeaderTargets.map((item) =>
        limit(() => client.getTaskDetail({ taskId: item.taskId, profile }).catch(() => null))
      )
    );
    const leaderByTaskId = new Map(
      missingLeaderTargets.map((item, idx) => [item.taskId, leaderDetails[idx]])
    );
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
      if (!local.sourceLeader) {
        patch.sourceLeader = leaderByTaskId.get(item.taskId)?.creatorInfo?.name ?? null;
      }
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
    retryWritebacks,
    writebackStatus,
  };
}
