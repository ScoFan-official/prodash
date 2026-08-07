import Select from '../primitives/Select'

// 近 30 天日期选项（含今天），供 Radix Select 选择日报日期。
function lastDays(count) {
  const result = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    result.push(`${d.getFullYear()}-${month}-${day}`)
  }
  return result
}

const DATE_OPTIONS = lastDays(30).map((d) => ({ value: d, label: d }))

// 日报日期选择：受控 YYYY-MM-DD 日期字符串。
export default function ReportDateSelector({ value, onChange }) {
  return (
    <label className="report-date-selector">
      日期
      <Select value={value} onValueChange={onChange} options={DATE_OPTIONS} />
    </label>
  )
}
