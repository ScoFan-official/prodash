// Dify Workflow API 客户端：真实模式调用 /v1/workflows/run，mock 模式返回固定 [Mock] 日报。
// 不写入日志；错误信息不带 API Key。
// 由 .worktrees/dify-daily-report/server/difyClient.js 移植，语义保持一致。

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_USER = 'prodash'
const MOCK_MARKER = '[Mock]'

export function createDifyClient({ baseUrl, apiKey, user, fetchImpl, timeoutMs, mock }) {
  if (mock) {
    return {
      async runWorkflow(inputs = {}) {
        const dateLine = inputs.report_date ? `日期：${inputs.report_date}\n` : ''
        return {
          report: `${MOCK_MARKER} 模拟日报（DIFY_MOCK=true，未调用真实 Dify）\n${dateLine}今日完成：\n（mock 模式未生成真实日报正文）`,
          generatedAt: new Date().toISOString(),
        }
      },
    }
  }

  if (!apiKey || !baseUrl) {
    const missing = [!apiKey ? 'DIFY_API_KEY' : null, !baseUrl ? 'DIFY_BASE_URL' : null]
      .filter(Boolean)
      .join('、')
    throw new Error(`Dify 未配置：缺少 ${missing}。开发环境可设置 DIFY_MOCK=true 使用 mock 模式。`)
  }

  const doFetch = fetchImpl || fetch
  const requestTimeout = timeoutMs || DEFAULT_TIMEOUT_MS
  const workflowUser = user || DEFAULT_USER
  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, '')

  return {
    async runWorkflow(inputs) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), requestTimeout)
      try {
        const response = await doFetch(`${normalizedBaseUrl}/v1/workflows/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            inputs,
            response_mode: 'blocking',
            user: workflowUser,
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`Dify API 请求失败：HTTP ${response.status}`)
        }
        const data = await response.json()
        const outputs = data?.data?.outputs
        const report = outputs?.report || outputs?.text
        if (!report) {
          throw new Error('Dify 返回内容为空或格式错误')
        }
        return { report: String(report), generatedAt: new Date().toISOString() }
      } catch (err) {
        if (err?.name === 'AbortError') {
          throw new Error('Dify 请求超时')
        }
        throw err
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
