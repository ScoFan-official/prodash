// 客户端 API 封装测试：mock 全局 fetch，验证 todo-sync 相关 endpoint。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { syncTodos, getTodoSyncStatus } from './client'

function stubFetch(status, body) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  // Vitest 4 的 vi.stubGlobal() 返回 utils 而非被 stub 的值（3.x 及更早返回 value），
  // 因此这里显式返回 mock，测试断言才能拿到 fetch spy。
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('syncTodos', () => {
  it('调用 POST /api/todo-sync 并返回结果', async () => {
    const body = {
      syncedAt: '2026-08-07T12:00:00.000Z',
      imported: 3,
      updated: 5,
      softDeleted: 1,
      writeback: { retried: 2, pending: 0 },
    }
    const fetchMock = stubFetch(200, body)
    const result = await syncTodos()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/todo-sync',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.imported).toBe(3)
  })

  it('inFlight 响应透传 { inFlight: true }', async () => {
    const fetchMock = stubFetch(202, { inFlight: true })
    const result = await syncTodos()
    expect(result).toEqual({ inFlight: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('非 2xx 抛出后端 error', async () => {
    stubFetch(503, { error: 'DINGTALK_TODO_PROFILE 未配置' })
    await expect(syncTodos()).rejects.toThrow('DINGTALK_TODO_PROFILE 未配置')
  })
})

describe('getTodoSyncStatus', () => {
  it('调用 GET /api/todo-sync（无 method）', async () => {
    const body = { syncedAt: null, lastResult: null, profile: 'corp:user', inFlight: false, configured: true }
    const fetchMock = stubFetch(200, body)
    const result = await getTodoSyncStatus()
    expect(fetchMock).toHaveBeenCalledWith('/api/todo-sync', expect.any(Object))
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
    expect(result.profile).toBe('corp:user')
  })
})
