import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import POView, { sessionFiles } from '../components/POView'
import { Empty } from '../components/ui'
import { useStore } from '../lib/store'

export default function PODetail() {
  const { id = '' } = useParams()
  const { getPO, data, uploads } = useStore()
  const po = getPO(id)
  if (!po) return <Empty>PO {id} not found. <Link to="/inbox" className="text-brand-600 underline">Back to inbox</Link></Empty>

  const sample = data?.samples.find((s) => s.po_id === id)
  const up = uploads.find((u) => u.id === id)
  const docUrl = sessionFiles.get(id) ?? (sample ? {
    url: `${import.meta.env.BASE_URL}samples/${sample.document_file}`,
    type: sample.file_format === 'pdf' ? 'application/pdf' : `image/${sample.file_format}`,
    name: sample.document_file,
  } : null)

  return (
    <div>
      <Link to={up ? '/process' : '/inbox'} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" /> {up ? 'Process a PO' : 'PO inbox'}
      </Link>
      {up && (
        <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-2.5 text-xs text-brand-700">
          Extracted from <b>{up.fileName}</b> via {up.method === 'claude' ? 'Claude document extraction' : up.method === 'benchmark' ? 'built-in extraction' : 'manual entry'} on {new Date(up.createdAt).toLocaleString()}.
          {up.notes && <> Notes: {up.notes}</>}
        </div>
      )}
      <POView po={po} docUrl={docUrl} />
    </div>
  )
}
