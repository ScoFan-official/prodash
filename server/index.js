// Prodash v1.0.0 后端入口。
// 启动方式：node --env-file=.env server/index.js （见 package.json scripts.server）
// 需要 .env 提供 DB_* 配置；.env 缺失或数据库不可连时会打印清晰错误并退出。
// 日报管道：difyClient（DIFY_MOCK 语义，非 mock 缺 key 启动即抛错退出）→
// publisher（PUBLISHER env，默认 mock）→ reportService → reports 路由 →
// 非测试环境启动定时调度器。

import mysql from 'mysql2/promise';
import { createMysqlRepos } from './repos/mysql.js';
import { createApp } from './app.js';
import { createDifyClient } from './dify/difyClient.js';
import { createPublisher } from './publishers/index.js';
import { createReportService } from './services/reportService.js';
import { createReportsRouter } from './routes/reports.js';
import { DwsTodoClient } from './todoSync/dwsTodoClient.js';
import { createTodoSyncService } from './todoSync/todoSyncService.js';
import { createTodoSyncRouter } from './routes/todoSync.js';
import { startScheduler, startTodoSync } from './scheduler.js';

const requiredEnv = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `[prodash-server] Missing required env vars: ${missing.join(', ')}.\n` +
      'Please create a .env file in the project root (see .env.example), then run `npm run server`.'
  );
  process.exit(1);
}

const {
  DB_HOST,
  DB_PORT = '3306',
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  PORT = '8787',
} = process.env;

// Dify 客户端：DIFY_MOCK=true/1 时返回 [Mock] 固定日报；
// 未 mock 且缺 DIFY_API_KEY/DIFY_BASE_URL → 启动即抛错退出。
const difyMockValue = String(process.env.DIFY_MOCK || '').toLowerCase();
const difyMock = difyMockValue === 'true' || difyMockValue === '1';
let difyClient;
try {
  difyClient = createDifyClient({
    baseUrl: process.env.DIFY_BASE_URL,
    apiKey: process.env.DIFY_API_KEY,
    user: process.env.DIFY_USER,
    timeoutMs: process.env.DIFY_TIMEOUT_MS ? Number(process.env.DIFY_TIMEOUT_MS) : undefined,
    mock: difyMock,
  });
} catch (err) {
  console.error(`[prodash-server] ${err.message}`);
  process.exit(1);
}

// 发布器：PUBLISHER=mock|file|dws（默认 mock）
if ((process.env.PUBLISHER || 'mock') === 'dws' && !process.env.DINGTALK_WIKI_WS_ID) {
  console.warn(
    '[prodash-server] [warn] PUBLISHER=dws 但 DINGTALK_WIKI_WS_ID 为空：' +
      '创建日报文档会失败并标记 publish_failed，请检查 .env（详见 docs/2026-08-06-Prodash-v1.0.0决策清单.md 第六节）。'
  );
}
const publisher = createPublisher(process.env.PUBLISHER || 'mock', {
  wsId: process.env.DINGTALK_WIKI_WS_ID,
  folderId: process.env.DINGTALK_WIKI_FOLDER_ID,
  dwsBin: process.env.DWS_BIN || 'dws',
  dwsScript: process.env.DWS_SCRIPT,
  outputDir: process.env.REPORTS_OUTPUT_DIR || 'reports-output/',
});

let pool;
try {
  pool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  });
  // 启动时验证数据库可达
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
} catch (err) {
  console.error(
    `[prodash-server] Cannot connect to MySQL at ${DB_HOST}:${DB_PORT} (user=${DB_USER}, db=${DB_NAME}): ${err.message}\n` +
      'Start the database with `docker compose up -d mysql`, then retry.'
  );
  process.exit(1);
}

const repos = createMysqlRepos(pool);
const service = createReportService({ difyClient, publisher });
const reportRouter = createReportsRouter({ repos, service });

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

// 调度器：仅在非测试环境启动
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

const port = Number(PORT);
app.listen(port, () => {
  console.log(
    `[prodash-server] listening on http://127.0.0.1:${port} (difyMock=${difyMock}, publisher=${process.env.PUBLISHER || 'mock'})`
  );
});
