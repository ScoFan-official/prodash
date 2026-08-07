const FIELDS = [
  { key: 'temporaryWork', label: '临时工作' },
  { key: 'meetings', label: '会议' },
  { key: 'risks', label: '风险' },
  { key: 'tomorrowPlan', label: '明日计划' },
]

// 日报补充内容：受控输入四个字段，不在此处持久化。
export default function ReportExtraInput({ value, onChange }) {
  return (
    <div className="report-extra-input">
      {FIELDS.map(({ key, label }) => (
        <div key={key} className="report-extra__field">
          <label htmlFor={`report-extra-${key}`}>{label}</label>
          <textarea
            id={`report-extra-${key}`}
            className="input--textarea"
            value={value[key] || ''}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </div>
      ))}
    </div>
  )
}
