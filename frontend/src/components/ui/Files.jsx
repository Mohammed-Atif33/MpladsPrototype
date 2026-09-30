import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, Download, ExternalLink } from 'lucide-react'
import { fetchBlobUrl, openProtectedFile, downloadProtectedFile } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { useToast } from './Overlay'

/** <img> for a protected API file (fetched with the bearer token, shown via object URL). */
export function AuthImage({ documentId, alt, className }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let url
    let live = true
    fetchBlobUrl(`/api/documents/${documentId}/file`)
      .then((u) => { url = u; if (live) setSrc(u) })
      .catch(() => live && setFailed(true))
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [documentId])
  if (failed) return <div className={`flex items-center justify-center bg-slate-100 text-xs text-slate-400 ${className}`}>Image unavailable</div>
  if (!src) return <div className={`animate-pulse bg-slate-100 ${className}`} />
  return <img src={src} alt={alt || ''} className={className} loading="lazy" />
}

export function DocumentRow({ doc, onOpen }) {
  const toast = useToast()
  const isImage = (doc.content_type || '').startsWith('image/')
  const open = async () => {
    try { onOpen ? onOpen(doc) : await openProtectedFile(`/api/documents/${doc.document_id}/file`) }
    catch (e) { toast(e.message, 'error') }
  }
  const download = async () => {
    try { await downloadProtectedFile(`/api/documents/${doc.document_id}/file`, doc.file_name) }
    catch (e) { toast(e.message, 'error') }
  }
  return (
    <li className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
      {isImage ? <ImageIcon className="h-5 w-5 text-slate-400" /> : <FileText className="h-5 w-5 text-slate-400" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-800">{doc.file_name}</div>
        <div className="text-xs text-slate-500">
          {doc.document_type} · v{doc.version} · {fmtDate(doc.uploaded_at)}{doc.uploaded_by ? ` · ${doc.uploaded_by}` : ''}
          {doc.is_public ? ' · public' : ''}
        </div>
      </div>
      <button className="btn-ghost btn-sm" onClick={open} title="Open"><ExternalLink className="h-4 w-4" /></button>
      <button className="btn-ghost btn-sm" onClick={download} title="Download"><Download className="h-4 w-4" /></button>
    </li>
  )
}
