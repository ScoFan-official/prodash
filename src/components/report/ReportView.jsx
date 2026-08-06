import { useEffect, useRef, useState } from 'react'
import { getReportSource, getReport, generateReport, publishReport, saveExtra } from '../../api/client'
import ReportDateSelector from './ReportDateSelector'
import ReportSourceSummary from './ReportSourceSummary'
import ReportExtraInput from './ReportExtraInput'
import ReportResult from './ReportResult'
import ReportHistory from './ReportHistory'

function todayString() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function createEmptyExtraWork() {
  return { temporaryWork: '', meetings: '', risks: '', tomorrowPlan: '' }
}

function normalizeExtra(extra) {
  return { ...createEmptyExtraWork(), ...(extra || {}) }
}

const STATUS_LABELS = {
  draft: '草稿',
  generated: '已生成',
  published: '已发布',
  publish_failed: '发布失败',
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '未知'
}

export default function ReportView() {
  const [date, setDate] = useState(todayString)
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [source, setSource] = useState(null)
  const [extraWork, setExtraWork] = useState(createEmptyExtraWork)
  const [existing, setExisting] = useState(null)
  const [phase, setPhase] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  // dateRef 始终指向最新选中日期：异步 handler 以此做竞态守卫，
  // 响应回来时若日期已切换则丢弃结果，避免旧日期覆盖新视图。
  const dateRef = useRef(date)

  // 日期变化时重新拉取数据源与当天已有日报/补充内容。
  useEffect(() => {
    let cancelled = false
    dateRef.current = date
    async function load() {
      setPhase('loading')
      setErrorMessage('')
      setCopied(false)
      setCopyFailed(false)
      try {
        const [sourceData, reportData] = await Promise.all([
          getReportSource(date, includeDeleted),
          getReport(date),
        ])
        if (cancelled) return
        setSource(sourceData)
        setExisting(reportData.report)
        setExtraWork(normalizeExtra(reportData.extra))
        setPhase('ready')
      } catch (err) {
        if (cancelled) return
        // 日期切换后加载失败：清空上一日期的残留内容，避免串台。
        setSource(null)
        setExisting(null)
        setExtraWork(createEmptyExtraWork())
        setErrorMessage(err?.message || '请求失败')
        setPhase('error')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [date, includeDeleted])

  function handleDateChange(nextDate) {
    dateRef.current = nextDate
    setDate(nextDate)
  }

  function refreshHistory() {
    setHistoryRefreshKey((key) => key + 1)
  }

  function isCurrentDate(d) {
    return dateRef.current === d
  }

  async function handleGenerate() {
    const d = dateRef.current
    setPhase('generating')
    setErrorMessage('')
    setCopied(false)
    setCopyFailed(false)
    try {
      const reportRow = await generateReport({ date: d, extraWork, includeDeleted })
      if (!isCurrentDate(d)) return
      setExisting(reportRow)
      setPhase('success')
      refreshHistory()
    } catch (err) {
      if (!isCurrentDate(d)) return
      setErrorMessage(err?.message || '日报生成失败，请稍后重试')
      setPhase('error')
    }
  }

  async function handleRegenerate() {
    const d = dateRef.current
    setPhase('generating')
    setErrorMessage('')
    setCopied(false)
    setCopyFailed(false)
    try {
      const reportRow = await generateReport({ date: d, extraWork, includeDeleted })
      if (!isCurrentDate(d)) return
      setExisting(reportRow)
      setPhase('success')
      refreshHistory()
    } catch (err) {
      if (!isCurrentDate(d)) return
      setErrorMessage(err?.message || '重新生成失败，请稍后重试')
      setPhase('error')
    }
  }

  async function handlePublish() {
    const d = dateRef.current
    setPhase('generating')
    setErrorMessage('')
    setCopied(false)
    setCopyFailed(false)
    try {
      const reportRow = await publishReport(d)
      if (!isCurrentDate(d)) return
      setExisting(reportRow)
      setPhase('success')
      refreshHistory()
    } catch (err) {
      if (!isCurrentDate(d)) return
      setErrorMessage(err?.message || '补发失败，请稍后重试')
      setPhase('error')
    }
  }

  // 保存补充内容后由后端负责触发自动重新生成，前端只需重新 GET report 刷新展示。
  async function handleSaveExtra() {
    const d = dateRef.current
    setPhase('generating')
    setErrorMessage('')
    setCopied(false)
    setCopyFailed(false)
    try {
      await saveExtra(d, extraWork)
      if (!isCurrentDate(d)) return
      const reportData = await getReport(d)
      if (!isCurrentDate(d)) return
      setExisting(reportData.report)
      setExtraWork(normalizeExtra(reportData.extra))
      setPhase('success')
      refreshHistory()
    } catch (err) {
      if (!isCurrentDate(d)) return
      setErrorMessage(err?.message || '保存失败，请稍后重试')
      setPhase('error')
    }
  }

  async function handleCopy() {
    if (!existing?.content) return
    try {
      await navigator.clipboard.writeText(existing.content)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

  const busy = phase === 'generating' || phase === 'loading'
  const showContent = phase !== 'loading'
  const canRepublish =
    existing?.status === 'publish_failed' ||
    (existing?.status === 'draft' && Boolean(existing.content))

  return (
    <section className="report-view">
      <h2>每日日报</h2>
      <ReportDateSelector value={date} onChange={handleDateChange} />
      <label className="report-include-deleted">
        <input
          type="checkbox"
          checked={includeDeleted}
          onChange={(e) => setIncludeDeleted(e.target.checked)}
        />
        日报中包含已删除任务
      </label>
      {busy && phase === 'loading' && <p className="report-loading">加载中…</p>}
      {showContent && (
        <>
          <ReportSourceSummary
            source={
              source || { completedTodos: [], pendingTodos: [], totalHumanMs: 0, totalAgentMs: 0 }
            }
          />
          <ReportExtraInput value={extraWork} onChange={setExtraWork} />
          {existing ? (
            <div className="report-action-area">
              <ReportResult report={existing.content} onCopy={handleCopy} copied={copied} />
              <p className="report-meta">
                版本：{existing.version ?? '—'}，状态：{statusLabel(existing.status)}
              </p>
              {existing.docUrl && (
                <a
                  className="report-doc-link"
                  href={existing.docUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  在钉钉知识库查看
                </a>
              )}
              {copyFailed && (
                <p className="report-error" role="alert">
                  请手动选择并复制
                </p>
              )}
              {errorMessage && (
                <p className="report-error" role="alert">
                  {errorMessage}
                </p>
              )}
              <div className="report-actions">
                <button type="button" onClick={handleRegenerate} disabled={busy}>
                  重新生成
                </button>
                {canRepublish && (
                  <button type="button" onClick={handlePublish} disabled={busy}>
                    补发
                  </button>
                )}
                <button type="button" onClick={handleSaveExtra} disabled={busy}>
                  保存补充内容
                </button>
              </div>
            </div>
          ) : (
            <div className="report-action-area">
              {errorMessage && (
                <p className="report-error" role="alert">
                  {errorMessage}
                </p>
              )}
              <button type="button" onClick={handleGenerate} disabled={busy}>
                生成日报
              </button>
            </div>
          )}
        </>
      )}
      <ReportHistory refreshKey={historyRefreshKey} />
    </section>
  )
}
