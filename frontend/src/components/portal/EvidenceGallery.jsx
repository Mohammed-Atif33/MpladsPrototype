import { useState } from 'react'
import { Film, FileText } from 'lucide-react'
import { AuthImage, Modal, useToast } from '../ui'
import { openProtectedFile } from '../../lib/api'

/** Thumbnails for complaint evidence (images inline; videos and other files open via an authenticated download). */
export default function EvidenceGallery({ evidence = [] }) {
  const [big, setBig] = useState(null)
  const toast = useToast()
  if (!evidence.length) return <p className="text-sm text-slate-500">No attachments.</p>
  const open = async (id) => {
    try { await openProtectedFile(`/api/documents/${id}/file`) } catch (e) { toast(e.message, 'error') }
  }
  return (
    <>
      <div className="flex flex-wrap gap-3">
        {evidence.map((ev) => ((ev.content_type || '').startsWith('image/') ? (
          <button key={ev.document_id} onClick={() => setBig(ev)} className="overflow-hidden rounded-md border border-slate-200 hover:border-navy-400" title={ev.file_name}>
            <AuthImage documentId={ev.document_id} alt={ev.file_name} className="h-24 w-32 object-cover" />
          </button>
        ) : (
          <button key={ev.document_id} onClick={() => open(ev.document_id)} className="flex h-24 w-32 flex-col items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-600 hover:border-navy-400">
            {(ev.content_type || '').startsWith('video/') ? <Film className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
            <span className="max-w-[7rem] truncate">{ev.file_name}</span>
          </button>
        )))}
      </div>
      <Modal open={!!big} onClose={() => setBig(null)} title={big?.file_name || 'Attachment'} size="lg">
        {big && <AuthImage documentId={big.document_id} alt={big.file_name} className="mx-auto max-h-[70vh] rounded" />}
      </Modal>
    </>
  )
}
