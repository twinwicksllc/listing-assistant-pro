import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import SupportModal from "@/components/SupportModal";
import CookieConsent from "./components/CookieConsent";
import { Loader2 } from "lucide-react";
import { ThemeProvider } from "@/providers/ThemeProvider";

// ── Public / auth pages (unchanged) ──────────────────────────────
const LandingPage = lazy(() => import("./pages/LandingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage"));
const EbayCallbackPage = lazy(() => import("./pages/EbayCallbackPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

// ── v2 App pages ──────────────────────────────────────────────────
const HomePage2 = lazy(() => import("./v2/pages/HomePage2"));
const SettingsPage2 = lazy(() => import("./v2/pages/SettingsPage2"));
const AnalyzePage2 = lazy(() => import("./v2/pages/AnalyzePage2"));
const DraftsPage2 = lazy(() => import("./v2/pages/DraftsPage2"));
const DashboardPage2 = lazy(() => import("./v2/pages/DashboardPage2"));
const BillingPage2 = lazy(() => import("./v2/pages/BillingPage2"));
const TeamPage2 = lazy(() => import("./v2/pages/TeamPage2"));
const AdminPage2 = lazy(() => import("./v2/pages/AdminPage2"));
const BulkListingPage2 = lazy(() => import("./v2/pages/BulkListingPage2"));
const MarketResearchPage2 = lazy(() => import("./v2/pages/MarketResearchPage2"));
const RepriceRulesPage2 = lazy(() => import("./v2/pages/RepriceRulesPage2"));
const ProfitReportPage2 = lazy(() => import("./v2/pages/ProfitReportPage2"));
const BulkCogsPage2 = lazy(() => import("./v2/pages/BulkCogsPage2"));
const HistoricalCogsPage2 = lazy(() => import("./v2/pages/HistoricalCogsPage2"));
const ListingsPage2 = lazy(() => import("./v2/pages/ListingsPage2"));

// Smart root redirect
function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }
  return user ? <Navigate to="/home" replace /> : <Navigate to="/landing" replace />;
}

const queryClient = new QueryClient();

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
    </div>
  );
}

const App = () => (
  <ErrorBoundary>
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
                {/* Root smart redirect */}
                <Route path="/" element={<RootRedirect />} />

                {/* Public routes */}
                <Route path="/landing"          element={<LandingPage />} />
                <Route path="/login"            element={<LoginPage />} />
                <Route path="/signup"           element={<SignupPage />} />
                <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
                <Route path="/reset-password"   element={<ResetPasswordPage />} />
                <Route path="/terms"            element={<TermsPage />} />
                <Route path="/privacy"          element={<PrivacyPage />} />
                <Route path="/auth/callback"    element={<AuthCallbackPage />} />
                <Route path="/ebay/callback"    element={<EbayCallbackPage />} />

                {/* Protected routes — all v2 */}
                <Route path="/home"          element={<ProtectedRoute><HomePage2 /></ProtectedRoute>} />
                <Route path="/analyze"       element={<ProtectedRoute><AnalyzePage2 /></ProtectedRoute>} />
                <Route path="/drafts"        element={<ProtectedRoute><DraftsPage2 /></ProtectedRoute>} />
                <Route path="/dashboard"     element={<ProtectedRoute ownerOnly><DashboardPage2 /></ProtectedRoute>} />
                <Route path="/settings"      element={<ProtectedRoute><SettingsPage2 /></ProtectedRoute>} />
                <Route path="/billing"       element={<ProtectedRoute ownerOnly><BillingPage2 /></ProtectedRoute>} />
                <Route path="/team"          element={<ProtectedRoute><TeamPage2 /></ProtectedRoute>} />
                <Route path="/admin"         element={<ProtectedRoute><AdminPage2 /></ProtectedRoute>} />
                <Route path="/bulk"          element={<ProtectedRoute><BulkListingPage2 /></ProtectedRoute>} />
                <Route path="/market"        element={<ProtectedRoute><MarketResearchPage2 /></ProtectedRoute>} />
                <Route path="/reprice-rules" element={<ProtectedRoute ownerOnly><RepriceRulesPage2 /></ProtectedRoute>} />
                <Route path="/profit-report" element={<ProtectedRoute ownerOnly><ProfitReportPage2 /></ProtectedRoute>} />
                <Route path="/cogs-editor"   element={<ProtectedRoute ownerOnly><BulkCogsPage2 /></ProtectedRoute>} />
                <Route path="/historical-cogs" element={<ProtectedRoute ownerOnly><HistoricalCogsPage2 /></ProtectedRoute>} />
                <Route path="/listings" element={<ProtectedRoute ownerOnly><ListingsPage2 /></ProtectedRoute>} />

                {/* Legacy preview aliases — redirect to canonical routes */}
                <Route path="/home2"     element={<Navigate to="/home"     replace />} />
                <Route path="/settings2" element={<Navigate to="/settings" replace />} />

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            <CookieConsent />
            <SupportModal />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;