import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import SupportModal from "@/components/SupportModal";
import CookieConsent from "./components/CookieConsent";
import { Loader2 } from "lucide-react";

// ── Public / auth pages (unchanged) ──────────────────────────────
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import EbayCallbackPage from "./pages/EbayCallbackPage";
import NotFound from "./pages/NotFound";

// ── v2 App pages ──────────────────────────────────────────────────
import HomePage2 from "./v2/pages/HomePage2";
import SettingsPage2 from "./v2/pages/SettingsPage2";
import AnalyzePage2 from "./v2/pages/AnalyzePage2";
import DraftsPage2 from "./v2/pages/DraftsPage2";
import DashboardPage2 from "./v2/pages/DashboardPage2";
import BillingPage2 from "./v2/pages/BillingPage2";
import TeamPage2 from "./v2/pages/TeamPage2";
import AdminPage2 from "./v2/pages/AdminPage2";
import BulkListingPage2 from "./v2/pages/BulkListingPage2";
import MarketResearchPage2 from "./v2/pages/MarketResearchPage2";
import RepriceRulesPage2 from "./v2/pages/RepriceRulesPage2";
import ProfitReportPage2 from "./v2/pages/ProfitReportPage2";
import BulkCogsPage2 from "./v2/pages/BulkCogsPage2";
import HistoricalCogsPage2 from "./v2/pages/HistoricalCogsPage2";
import ListingsPage2 from "./v2/pages/ListingsPage2";

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

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
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
            <CookieConsent />
            <SupportModal />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;