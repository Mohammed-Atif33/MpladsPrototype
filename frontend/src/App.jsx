import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { HOME, ROLE } from './lib/nav'
import AppLayout from './components/layout/AppLayout'
import { Spinner } from './components/ui'
import Login from './pages/common/Login'

const Register = lazy(() => import('./pages/common/Register'))
const ForgotPassword = lazy(() => import('./pages/common/ForgotPassword'))
const Profile = lazy(() => import('./pages/common/Profile'))
const Notifications = lazy(() => import('./pages/common/Notifications'))
const NotFound = lazy(() => import('./pages/common/NotFound'))
const Admin = lazy(() => import('./pages/admin/Admin'))

// Citizen
const CitizenDashboard = lazy(() => import('./pages/citizen/Dashboard'))
const CitizenProjects = lazy(() => import('./pages/citizen/Projects'))
const CitizenProjectDetail = lazy(() => import('./pages/citizen/ProjectDetail'))
const CitizenComplaints = lazy(() => import('./pages/citizen/Complaints'))
const CitizenComplaintForm = lazy(() => import('./pages/citizen/ComplaintForm'))
const CitizenComplaintDetail = lazy(() => import('./pages/citizen/ComplaintDetail'))
// Agency
const AgencyDashboard = lazy(() => import('./pages/agency/Dashboard'))
const AgencyProjects = lazy(() => import('./pages/agency/Projects'))
const AgencyProjectDetail = lazy(() => import('./pages/agency/ProjectDetail'))
const AgencyRequests = lazy(() => import('./pages/agency/Requests'))
const AgencyComplaints = lazy(() => import('./pages/agency/Complaints'))
const AgencyClarifications = lazy(() => import('./pages/agency/Clarifications'))
// Officer
const OfficerDashboard = lazy(() => import('./pages/officer/Dashboard'))
const UploadPdf = lazy(() => import('./pages/officer/UploadPdf'))
const Extractions = lazy(() => import('./pages/officer/Extractions'))
const ExtractionPreview = lazy(() => import('./pages/officer/ExtractionPreview'))
const OfficerRequests = lazy(() => import('./pages/officer/Requests'))
// Head officer
const HeadDashboard = lazy(() => import('./pages/head/Dashboard'))
const HeadCases = lazy(() => import('./pages/head/Cases'))
// MP (Member of Parliament)
const MpDashboard = lazy(() => import('./pages/mp/Dashboard'))
const MpCreateProject = lazy(() => import('./pages/mp/CreateProject'))
const MpAssignments = lazy(() => import('./pages/mp/Assignments'))
const MpReports = lazy(() => import('./pages/mp/Reports'))
const MpRequests = lazy(() => import('./pages/mp/Requests'))
const MpComplaints = lazy(() => import('./pages/mp/Complaints'))
const MpRisk = lazy(() => import('./pages/mp/Risk'))
const MpTransparency = lazy(() => import('./pages/mp/Transparency'))
// Shared (behaviour/actions depend on the logged-in role)
const Projects = lazy(() => import('./pages/shared/Projects'))
const CaseView = lazy(() => import('./pages/shared/CaseView'))
const ReviewComplaints = lazy(() => import('./pages/shared/Complaints'))
const Inspections = lazy(() => import('./pages/shared/Inspections'))
const Decisions = lazy(() => import('./pages/shared/Decisions'))
const MapPage = lazy(() => import('./pages/shared/MapPage'))
const Audit = lazy(() => import('./pages/shared/Audit'))

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner className="min-h-screen" label="Loading your session…" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

/** Frontend guard - the API enforces the same rules, so this is only about showing the right screens. */
function RoleRoute({ roles, children }) {
  const { user, setNotice } = useAuth()
  if (!roles.includes(user.role)) {
    setTimeout(() => setNotice('You do not have access to that page.'), 0)
    return <Navigate to={HOME[user.role]} replace />
  }
  return children
}

const guard = (roles, el) => <RoleRoute roles={roles}>{el}</RoleRoute>
const C = [ROLE.CITIZEN], A = [ROLE.AGENCY], O = [ROLE.OFFICER], H = [ROLE.HEAD], OH = [ROLE.OFFICER, ROLE.HEAD], AD = [ROLE.ADMIN], M = [ROLE.MP]

function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={HOME[user.role] || '/login'} replace />
}

export default function App() {
  return (
    <Suspense fallback={<Spinner className="min-h-screen" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<HomeRedirect />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/notifications" element={<Notifications />} />

          {/* Citizen */}
          <Route path="/citizen" element={guard(C, <CitizenDashboard />)} />
          <Route path="/citizen/projects" element={guard(C, <CitizenProjects />)} />
          <Route path="/citizen/projects/:id" element={guard(C, <CitizenProjectDetail />)} />
          <Route path="/citizen/complaints" element={guard(C, <CitizenComplaints />)} />
          <Route path="/citizen/complaints/new" element={guard(C, <CitizenComplaintForm />)} />
          <Route path="/citizen/complaints/:id" element={guard(C, <CitizenComplaintDetail />)} />

          {/* Implementing agency */}
          <Route path="/agency" element={guard(A, <AgencyDashboard />)} />
          <Route path="/agency/projects" element={guard(A, <AgencyProjects />)} />
          <Route path="/agency/projects/:id" element={guard(A, <AgencyProjectDetail />)} />
          <Route path="/agency/requests" element={guard(A, <AgencyRequests />)} />
          <Route path="/agency/complaints" element={guard(A, <AgencyComplaints />)} />
          <Route path="/agency/clarifications" element={guard(A, <AgencyClarifications />)} />

          {/* Officer */}
          <Route path="/officer" element={guard(O, <OfficerDashboard />)} />
          <Route path="/officer/upload" element={guard(O, <UploadPdf />)} />
          <Route path="/officer/extractions" element={guard(O, <Extractions />)} />
          <Route path="/officer/extractions/:id" element={guard(O, <ExtractionPreview />)} />
          <Route path="/officer/requests" element={guard(O, <OfficerRequests />)} />
          <Route path="/officer/projects" element={guard(O, <Projects />)} />
          <Route path="/officer/projects/:id" element={guard(O, <CaseView />)} />
          <Route path="/officer/complaints" element={guard(O, <ReviewComplaints />)} />
          <Route path="/officer/inspections" element={guard(O, <Inspections />)} />
          <Route path="/officer/decisions" element={guard(O, <Decisions />)} />
          <Route path="/officer/map" element={guard(O, <MapPage />)} />
          <Route path="/officer/audit" element={guard(O, <Audit />)} />

          {/* Head officer */}
          <Route path="/head" element={guard(H, <HeadDashboard />)} />
          <Route path="/head/cases" element={guard(H, <HeadCases />)} />
          <Route path="/head/projects" element={guard(H, <Projects />)} />
          <Route path="/head/projects/:id" element={guard(H, <CaseView />)} />
          <Route path="/head/complaints" element={guard(H, <ReviewComplaints />)} />
          <Route path="/head/inspections" element={guard(H, <Inspections />)} />
          <Route path="/head/decisions" element={guard(H, <Decisions />)} />
          <Route path="/head/map" element={guard(H, <MapPage />)} />
          <Route path="/head/audit" element={guard(H, <Audit />)} />

          {/* Member of Parliament (MP) */}
          <Route path="/mp" element={guard(M, <MpDashboard />)} />
          <Route path="/mp/create-project" element={guard(M, <MpCreateProject />)} />
          <Route path="/mp/projects" element={guard(M, <Projects />)} />
          <Route path="/mp/projects/:id" element={guard(M, <CaseView />)} />
          <Route path="/mp/assignments" element={guard(M, <MpAssignments />)} />
          <Route path="/mp/reports" element={guard(M, <MpReports />)} />
          <Route path="/mp/requests" element={guard(M, <MpRequests />)} />
          <Route path="/mp/complaints" element={guard(M, <MpComplaints />)} />
          <Route path="/mp/inspections" element={guard(M, <Inspections />)} />
          <Route path="/mp/risk" element={guard(M, <MpRisk />)} />
          <Route path="/mp/transparency" element={guard(M, <MpTransparency />)} />
          <Route path="/mp/map" element={guard(M, <MapPage />)} />
          <Route path="/mp/audit" element={guard(M, <Audit />)} />

          {/* Admin (optional role) */}
          <Route path="/admin" element={guard(AD, <Admin />)} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
