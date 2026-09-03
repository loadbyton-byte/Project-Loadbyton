import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth, roleHome, homePath } from './lib/auth.jsx';
import { Shell } from './components/Shell.jsx';
import { Spinner } from './components/ui.jsx';

// The public marketing pages stay eager imports: scripts/prerender.mjs
// server-renders exactly these nine routes synchronously
// (renderToStaticMarkup, no Suspense support), so entry-server.jsx must be
// able to render them without hitting a lazy() boundary.
import Landing from './pages/Landing.jsx';
import Features from './pages/Features.jsx';
import Pricing from './pages/Pricing.jsx';
import About from './pages/About.jsx';
import Blog from './pages/Blog.jsx';
import Security from './pages/Security.jsx';
import Compliance from './pages/Compliance.jsx';
import Terms from './pages/Terms.jsx';
import Privacy from './pages/Privacy.jsx';
import NotFound from './pages/NotFound.jsx';

// Everything behind a login (or login itself) is never part of that
// prerender pass — StaticRouter only ever matches one of the seven routes
// above during SSR, so these lazy chunks are simply never reached there.
// Splitting them keeps a first-time public visitor from downloading the
// entire dashboard/admin app just to read the pricing page.
const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const OpenLoads = lazy(() => import('./pages/OpenLoads.jsx'));
const JobDetail = lazy(() => import('./pages/JobDetail.jsx'));
const JobDispute = lazy(() => import('./pages/JobDispute.jsx'));
const MyBids = lazy(() => import('./pages/MyBids.jsx'));
const WonJobs = lazy(() => import('./pages/WonJobs.jsx'));
const Templates = lazy(() => import('./pages/Templates.jsx'));
const Contracts = lazy(() => import('./pages/Contracts.jsx'));
const Earnings = lazy(() => import('./pages/Earnings.jsx'));
const Drivers = lazy(() => import('./pages/Drivers.jsx'));
const Analytics = lazy(() => import('./pages/Analytics.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const DocumentCompliance = lazy(() => import('./pages/DocumentCompliance.jsx'));
const DriverHome = lazy(() => import('./pages/DriverHome.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Invoices = lazy(() => import('./pages/Invoices.jsx'));

// Every navigation lands at the top of the new page — a long page left
// scrolled midway (a job list, a document thread) must never hand off
// mid-viewport when the route changes. Keyed on pathname only, so an
// in-page interaction (tabs, modals) never jars the scroll position.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <Spinner size={28} className="text-brand-primary" />
    </div>
  );
}

function RequireAuth({ roles, children }) {
  const { user, actingAs, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // A driver seat's user.role is still its owner's role (CARRIER), so it
  // would otherwise pass every roles=['CARRIER'] check below and reach the
  // full carrier dashboard — the backend already blocks its API calls
  // (middleware/auth.js's DRIVER_SEAT_ALLOWED_ROUTES), but it should never
  // even render those pages. Checked before the roles check so it applies
  // uniformly regardless of what a route asks for.
  if (actingAs?.seatRole === 'DRIVER') return <Navigate to="/driver" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={roleHome(user.role)} replace />;
  return children;
}

// Wraps the driver-only view itself — anyone who isn't a driver seat is
// sent to their normal home instead (mirrors RequireAuth's role redirect).
function DriverOnly({ children }) {
  const { user, actingAs, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (actingAs?.seatRole !== 'DRIVER') return <Navigate to={homePath(user, actingAs)} replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user, actingAs, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  if (user) return <Navigate to={homePath(user, actingAs)} replace />;
  return children;
}

export default function App() {
  return (
    <Shell>
      <ScrollToTop />
      <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/features" element={<Features />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/about" element={<About />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/security" element={<Security />} />
          <Route path="/compliance" element={<Compliance />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />

          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
          <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
          <Route path="/reset-password" element={<GuestOnly><ResetPassword /></GuestOnly>} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route path="/dashboard" element={<RequireAuth roles={['SHIPPER']}><Dashboard /></RequireAuth>} />
          <Route path="/templates" element={<RequireAuth roles={['SHIPPER']}><Templates /></RequireAuth>} />
          <Route path="/contracts" element={<RequireAuth roles={['SHIPPER']}><Contracts /></RequireAuth>} />

          <Route path="/open-loads" element={<RequireAuth roles={['CARRIER']}><OpenLoads /></RequireAuth>} />
          <Route path="/my-bids" element={<RequireAuth roles={['CARRIER']}><MyBids /></RequireAuth>} />
          <Route path="/won-jobs" element={<RequireAuth roles={['CARRIER']}><WonJobs /></RequireAuth>} />
          <Route path="/earnings" element={<RequireAuth roles={['CARRIER']}><Earnings /></RequireAuth>} />
          <Route path="/invoices" element={<RequireAuth roles={['CARRIER']}><Invoices /></RequireAuth>} />
          <Route path="/drivers" element={<RequireAuth roles={['CARRIER']}><Drivers /></RequireAuth>} />

          <Route path="/admin" element={<RequireAuth roles={['ADMIN']}><Admin /></RequireAuth>} />

          <Route path="/analytics" element={<RequireAuth roles={['SHIPPER', 'CARRIER']}><Analytics /></RequireAuth>} />
          <Route path="/jobs/:id" element={<RequireAuth><JobDetail /></RequireAuth>} />
          <Route path="/jobs/:id/dispute" element={<RequireAuth><JobDispute /></RequireAuth>} />
          <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/documents" element={<RequireAuth roles={['SHIPPER', 'CARRIER']}><DocumentCompliance /></RequireAuth>} />
          <Route path="/messages" element={<RequireAuth roles={['SHIPPER', 'CARRIER', 'ADMIN']}><Messages /></RequireAuth>} />
          <Route path="/driver" element={<DriverOnly><DriverHome /></DriverOnly>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
