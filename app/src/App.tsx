import { AlertTriangle, Loader2 } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { LogoMark } from './components/Logo'
import { useStore } from './lib/store'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Process = lazy(() => import('./pages/Process'))
const Inbox = lazy(() => import('./pages/Inbox'))
const PODetail = lazy(() => import('./pages/PODetail'))
const ReviewQueue = lazy(() => import('./pages/ReviewQueue'))
const SalesOrders = lazy(() => import('./pages/SalesOrders'))
const SalesOrderDoc = lazy(() => import('./pages/SalesOrderDoc'))
const Evaluation = lazy(() => import('./pages/Evaluation'))
const Catalogue = lazy(() => import('./pages/Catalogue'))
const Customers = lazy(() => import('./pages/Customers'))
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'))
const HowItWorks = lazy(() => import('./pages/HowItWorks'))
const SettingsPage = lazy(() => import('./pages/Settings'))

function Loading({ label }: { label: string }) {
  return (
    <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">
      <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {label}</div>
    </div>
  )
}

export default function App() {
  const { status, progress, error } = useStore()
  if (status === 'error')
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-surface p-6 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold text-red-700"><AlertTriangle className="h-4 w-4" /> Could not load the dataset</div>
          <p className="text-slate-600">{error}</p>
          <p className="mt-2 text-slate-500">Make sure <code>public/data/*.parquet</code> exist (run <code>python3 scripts/build_data.py</code>).</p>
        </div>
      </div>
    )
  if (status === 'loading')
    return (
      <div className="grid h-full place-items-center">
        <div className="w-72 text-center">
          <LogoMark size={48} className="mx-auto mb-4" />
          <div className="text-sm font-medium text-slate-800">Loading catalogue, customers & history</div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <div className="mt-2 text-xs text-slate-500">{progress.label}.parquet</div>
        </div>
      </div>
    )
  return (
    <Layout>
      <Suspense fallback={<Loading label="Loading…" />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/process" element={<Process />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/po/:id" element={<PODetail />} />
          <Route path="/review" element={<ReviewQueue />} />
          <Route path="/sales-orders" element={<SalesOrders />} />
          <Route path="/sales-orders/:id" element={<SalesOrderDoc />} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/catalogue" element={<Catalogue />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
