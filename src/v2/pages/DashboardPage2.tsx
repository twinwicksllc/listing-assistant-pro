/**
 * DashboardPage2 — v2 styled wrapper
 */
import DashboardPage from "@/pages/DashboardPage";
import AppShell from "@/v2/components/AppShell";

export default function DashboardPage2() {
  return (
    <AppShell>
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
        backgroundAttachment: "fixed",
      }}>
        <DashboardPage />
      </div>
    </AppShell>
  );
}