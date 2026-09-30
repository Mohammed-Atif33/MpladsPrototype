import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowRight, Download, FileUp, FileText, Loader2, UploadCloud } from 'lucide-react'
import { api, downloadProtectedFile } from '../../lib/api'
import { Card, CardHeader, ErrorBanner, Notice, PageHeader, Spinner, useApi, useToast } from '../../components/ui'

const STEPS = ['Upload', 'Extract', 'Verify', 'Store', 'Compare', 'Analyse']
const MAX_MB = 10

export default function UploadPdf() {
  const navigate = useNavigate()
  const toast = useToast()
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const samples = useApi(() => api.get('/api/demo/sample-pdfs'), [])

  const pick = (f) => {
    setError('')
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') { setFile(null); return setError('Only PDF files can be uploaded.') }
    if (f.size > MAX_MB * 1024 * 1024) { setFile(null); return setError(`The file is larger than ${MAX_MB} MB.`) }
    if (f.size === 0) { setFile(null); return setError('The file is empty.') }
    setFile(f)
  }

  const upload = async () => {
    if (!file) return
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const ex = await api.upload('/api/projects/upload-pdf', form)
      toast('PDF uploaded and extracted. Please verify the extracted data.')
      navigate(`/officer/extractions/${ex.extraction_id}`)
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  const download = async (name) => {
    try { await downloadProtectedFile(`/api/demo/sample-pdfs/${encodeURIComponent(name)}`, name) } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <PageHeader title="Upload Project PDF" subtitle="New projects enter the platform through a project PDF. Extracted data must be verified by an officer before it is analysed." />

      <ol className="mb-5 flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={clsx('rounded-full px-3 py-1 font-medium', i === 0 ? 'bg-navy-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>{i + 1}. {s}</span>
            {i < STEPS.length - 1 && <ArrowRight className="h-4 w-4 text-slate-300" />}
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Select the project PDF" icon={FileUp} />
          <ErrorBanner error={error} className="mb-3" />
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]) }}
            onClick={() => inputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            className={clsx('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition',
              drag ? 'border-navy-500 bg-navy-50' : 'border-slate-300 bg-slate-50 hover:border-navy-400')}>
            <UploadCloud className="h-10 w-10 text-navy-400" />
            <div className="text-sm font-medium text-slate-700">Drag & drop a PDF here, or click to browse</div>
            <div className="text-xs text-slate-500">PDF only · up to {MAX_MB} MB · text-based or scanned</div>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          </div>

          {file && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2"><FileText className="h-5 w-5 shrink-0 text-red-500" />
                <div className="min-w-0"><div className="truncate text-sm font-medium">{file.name}</div><div className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</div></div></div>
              <button className="btn-ghost btn-sm" onClick={() => setFile(null)} disabled={busy}>Remove</button>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" onClick={upload} disabled={!file || busy}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading & extracting…</> : <><UploadCloud className="h-4 w-4" /> Upload & Extract</>}
            </button>
            {busy && <span className="text-xs text-slate-500">Validating the PDF and reading text, tables and fields…</span>}
          </div>
          <Notice className="mt-4">The file is validated (type, size, structure, no active content) and stored securely. Nothing is analysed until you verify the extracted data.</Notice>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Demo sample PDFs" subtitle="Synthetic documents for the walkthrough" />
          {samples.loading && !samples.data ? <Spinner /> : samples.error ? <ErrorBanner error={samples.error} onRetry={samples.reload} /> : (
            <ul className="space-y-3">
              {(samples.data || []).map((s) => (
                <li key={s.name} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="truncate text-sm font-medium text-slate-800">{s.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{s.description}</div></div>
                    <button className="btn-secondary btn-sm shrink-0" onClick={() => download(s.name)}><Download className="h-3.5 w-3.5" /> Download</button>
                  </div>
                </li>
              ))}
              {(samples.data || []).length === 0 && <li className="text-sm text-slate-500">No sample PDFs found on the server.</li>}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
