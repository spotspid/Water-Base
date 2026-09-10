import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import ProtectedRoute from './components/ProtectedRoute'
import RouteBoundary from './components/RouteBoundary'
import './App.css'

// Login stays in the main bundle, because it is the first thing a signed out
// visitor sees and splitting it would put a spinner in front of the only
// screen they can reach. Everything behind the sign in is loaded on demand,
// which keeps the initial download to the shell plus one page rather than the
// whole app including the calendar and every modal.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Jobs = lazy(() => import('./pages/Jobs'))
const NewJob = lazy(() => import('./pages/NewJob'))
const Schedule = lazy(() => import('./pages/Schedule'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Orders = lazy(() => import('./pages/Orders'))
const Templates = lazy(() => import('./pages/Templates'))
const Documents = lazy(() => import('./pages/Documents'))
const Expenses = lazy(() => import('./pages/Expenses'))
const PnL = lazy(() => import('./pages/PnL'))
const Settings = lazy(() => import('./pages/Settings'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))

function RouteFallback() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      Loading...
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/jobs" element={<ProtectedRoute><Jobs /></ProtectedRoute>} />
            <Route path="/jobs/new" element={<ProtectedRoute><NewJob /></ProtectedRoute>} />
            <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
            <Route path="/templates" element={<ProtectedRoute><Templates /></ProtectedRoute>} />
            <Route path="/documents" element={<ProtectedRoute><Documents /></ProtectedRoute>} />
            <Route path="/expenses" element={<ProtectedRoute><Expenses /></ProtectedRoute>} />
            <Route path="/pnl" element={<ProtectedRoute><PnL /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </RouteBoundary>
    </BrowserRouter>
  )
}
