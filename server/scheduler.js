// 日报定时调度：node-cron。
// runAutoReport 为可独立测试的纯函数（不依赖真实 cron），startScheduler 负责挂 cron 任务，
// stopScheduler 供测试/重启清理。

import cron from 'node-cron';
import { localToday } from './repos/timeutil.js';

let cronTask = null;

/**
 * 自动生成日报的纯逻辑：
 * - date 缺省用本地今天；
 * - 当天已存在 status='published' 的 report → 跳过，返回 { skipped: true }；
 * - 否则读取当天 extras（可空）并 service.generate，返回 { skipped: false, report }；
 * - 任何异常 console.error，不崩溃，返回 { skipped: false, error }。
 */
export async function runAutoReport({ repos, service, date }) {
  try {
    const dateStr = date || localToday();
    const existing = await repos.reports.getByDate(dateStr);
    if (existing && existing.status === 'published') {
      return { skipped: true };
    }
    const extraWork = await repos.extras.getByDate(dateStr);
    const report = await service.generate(repos, {
      date: dateStr,
      extraWork: extraWork ?? undefined,
      includeDeleted: false,
    });
    return { skipped: false, report };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[scheduler] auto report failed:', err?.message || err);
    return { skipped: false, error: err?.message || String(err) };
  }
}

/**
 * 启动 cron 调度（默认每天 21:00）。
 * 仅由入口在非测试环境调用；非法 cron 表达式直接抛错。
 * @returns {object} node-cron 任务句柄
 */
export function startScheduler({ repos, service, cron: cronExpr = '0 21 * * *' }) {
  if (!cron.validate(cronExpr)) {
    throw new Error(`[scheduler] 无效的 cron 表达式: ${cronExpr}`);
  }
  stopScheduler();
  cronTask = cron.schedule(cronExpr, () => {
    runAutoReport({ repos, service }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[scheduler]', err);
    });
  });
  return cronTask;
}

/** 停止当前 cron 任务（测试与重启用）。 */
export function stopScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}

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
