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
import HomePage from "./pages/HomePage";
import LandingPage from "./pages/LandingPage";
import AnalyzePage from "./pages/AnalyzePage";
import DraftsPage from "./pages/DraftsPage";
import DashboardPage from "./pages/DashboardPage";
import BillingPage from "./pages/BillingPage";
import TeamPage from "./pages/TeamPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import NotFound from "./pages/NotFound";
import AdminPage from "./pages/AdminPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import CookieConsent from "./components/CookieConsent";
import { Loader2 } from "lucide-react";

// Smart root: authenticated → /home, unauthenticated → landing page
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
              <Route path="/landing" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />

              {/* Protected routes */}
              <Route path="/home" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
              <Route path="/analyze" element={<ProtectedRoute><AnalyzePage /></ProtectedRoute>} />
              <Route path="/drafts" element={<ProtectedRoute><DraftsPage /></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute ownerOnly><DashboardPage /></ProtectedRoute>} />
              <Route path="/billing" element={<ProtectedRoute ownerOnly><BillingPage /></ProtectedRoute>} />
              <Route path="/team" element={<ProtectedRoute><TeamPage /></ProtectedRoute>} />
              <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
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