// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { createDifyClient } from './difyClient.js'

describe('createDifyClient 真实模式', () => {
  test('调用 /v1/workflows/run，携带正确 URL、Header 与请求体', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { outputs: { report: '今日完成\n1. 完成测试' } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = createDifyClient({
      baseUrl: 'https://dify.example.com/',
      apiKey: 'sk-test-123',
      user: 'alice',
      fetchImpl,
    })
    const inputs = { report_date: '2026-08-05', completed_tasks: '[]' }
    const result = await client.runWorkflow(inputs)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://dify.example.com/v1/workflows/run')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test-123',
    })
    expect(JSON.parse(options.body)).toEqual({
      inputs,
      response_mode: 'blocking',
      user: 'alice',
    })
    expect(result.report).toContain('完成测试')
    expect(result.generatedAt).toBeTruthy()
  })

  test('工作流输出使用 text 键时读取 data.outputs.text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { outputs: { text: '文本模式日报' } } }), {
        status: 200,
      }),
    )
    const client = createDifyClient({
      baseUrl: 'https://dify.example.com',
      apiKey: 'k',
      user: 'u',
      fetchImpl,
    })
    const result = await client.runWorkflow({})
    expect(result.report).toBe('文本模式日报')
  })

  test('data.outputs 为空时视为格式错误', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { outputs: {} } }), { status: 200 }))
    const client = createDifyClient({
      baseUrl: 'https://dify.example.com',
      apiKey: 'k',
      user: 'u',
      fetchImpl,
    })
    await expect(client.runWorkflow({})).rejects.toThrow(/格式|为空/)
  })

  test('Dify 返回非 2xx 时抛出错误', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('oops', { status: 500 }))
    const client = createDifyClient({
      baseUrl: 'https://dify.example.com',
      apiKey: 'k',
      user: 'u',
      fetchImpl,
    })
    await expect(client.runWorkflow({})).rejects.toThrow()
  })

  test('超过 timeoutMs 时中止请求并报超时', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const client = createDifyClient({
      baseUrl: 'https://dify.example.com',
      apiKey: 'k',
      user: 'u',
      timeoutMs: 30,
      fetchImpl,
    })
    await expect(client.runWorkflow({})).rejects.toThrow(/超时/)
  })
})

describe('createDifyClient mock 与配置检查', () => {
  test('mock 模式不调用 fetch 并返回 [Mock] 固定日报', async () => {
    const fetchImpl = vi.fn()
    const client = createDifyClient({
      baseUrl: 'https://dify.example.com',
      apiKey: 'k',
      user: 'u',
      fetchImpl,
      mock: true,
    })
    const result = await client.runWorkflow({ report_date: '2026-08-05' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.report).toContain('[Mock]')
    expect(result.generatedAt).toBeTruthy()
  })

  test('未 mock 且缺 API Key 时抛出配置错误', () => {
    expect(() => createDifyClient({ baseUrl: 'https://dify.example.com', user: 'u' })).toThrow(
      /DIFY_API_KEY|配置/,
    )
  })

  test('未 mock 且缺 baseUrl 时抛出配置错误', () => {
    expect(() => createDifyClient({ apiKey: 'k', user: 'u' })).toThrow(/DIFY_BASE_URL|配置/)
  })
})
