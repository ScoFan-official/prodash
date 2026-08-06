import { useEffect, useState } from 'react'
import { listReports } from '../../api/client'

const STATUS_LABELS = {
  draft: '草稿',
  generated: '已生成',
  published: '已发布',
  publish_failed: '发布失败',
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '未知'
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 日报历史列表：mount 时拉取，refreshKey 变化（生成/补发/保存成功后）时重新拉取。
// 加载失败静默降级：不渲染任何内容，避免阻塞主视图。
export default function ReportHistory({ refreshKey = 0 }) {
  const [reports, setReports] = useState([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    ;(async () => {
      try {
        const data = await listReports()
        if (cancelled) return
        setReports(Array.isArray(data) ? data : [])
      } catch {
        if (cancelled) return
        setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (failed) return null

  return (
    <div className="report-history">
      <h3>日报历史</h3>
      {reports.length === 0 ? (
        <p className="report-history-empty">暂无历史日报</p>
      ) : (
        <table className="report-history-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>状态</th>
              <th>版本</th>
              <th>知识库链接</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.date}>
                <td>{report.date}</td>
                <td>{statusLabel(report.status)}</td>
                <td>{report.version ?? '—'}</td>
                <td>
                  {report.docUrl ? (
                    <a href={report.docUrl} target="_blank" rel="noreferrer">
                      在钉钉知识库查看
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{formatDateTime(report.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
