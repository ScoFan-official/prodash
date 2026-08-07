// 钉钉待办同步 HTTP 路由（挂载前缀 /api/todo-sync）。
// createTodoSyncRouter({ service })：service 由入口/测试注入。
// POST 为异步触发：节流命中直接返回缓存结果；进行中返回 202；未配置 profile 返回 503。

import { Router } from 'express';

const ah = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export function createTodoSyncRouter({ service }) {
  const router = Router();

  router.post(
    '/',
    ah(async (req, res) => {
      if (!service.isConfigured()) {
        return res.status(503).json({
          error:
            'DINGTALK_TODO_PROFILE 未配置：请先在 .env 配置来源组织（corpId:userId），钉钉待办同步不可用',
        });
      }
      const cached = await service.throttleSkip();
      if (cached) return res.json(cached);
      const result = await service.syncFromDingtalk();
      if (result && result.inFlight) return res.status(202).json({ inFlight: true });
      res.json(result);
    })
  );

  router.get(
    '/',
    ah(async (req, res) => {
      res.json(service.getStatus());
    })
  );

  return router;
}
