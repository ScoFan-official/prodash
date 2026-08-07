import Card from '../primitives/Card'
import Button from '../primitives/Button'

// 日报结果：展示日报正文和复制按钮。
export default function ReportResult({ report, onCopy, copied }) {
  return (
    <Card className="report-result">
      <h2>日报结果</h2>
      <pre className="report-result-body">{report}</pre>
      <Button variant={copied ? 'outline' : 'default'} onClick={onCopy}>
        {copied ? '已复制' : '复制日报'}
      </Button>
      {copied && <p role="status">已复制到剪贴板</p>}
    </Card>
  )
}
