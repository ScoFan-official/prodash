// 日报数据源摘要：展示所选日期下已完成/未完成的任务数量，以及人工/AI 双轨总时长。
function formatMs(ms) {
  const totalMinutes = Math.round(Number(ms) / 60000)
  if (Number.isNaN(totalMinutes) || totalMinutes < 0) return '0分钟'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}小时${minutes}分钟`
  return `${minutes}分钟`
}

export default function ReportSourceSummary({ source }) {
  const total = source.completedTodos.length + source.pendingTodos.length
  return (
    <div className="report-source-summary">
      <p>
        当天共 {total} 个任务，已完成 {source.completedTodos.length} 个，未完成{' '}
        {source.pendingTodos.length} 个
      </p>
      <p>
        双轨总时长：人工 {formatMs(source.totalHumanMs)}，AI{' '}
        {formatMs(source.totalAgentMs)}
      </p>
    </div>
  )
}
