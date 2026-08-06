// 日报日期选择：受控 YYYY-MM-DD 日期字符串。
export default function ReportDateSelector({ value, onChange }) {
  return (
    <label className="report-date-selector">
      日期
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
