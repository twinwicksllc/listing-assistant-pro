/**
 * BillingPage2 — v2 styled wrapper
 */
import BillingPage from "@/pages/BillingPage";
import AppShell from "@/v2/components/AppShell";

export default function BillingPage2() {
  return (
    <AppShell>
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
        backgroundAttachment: "fixed",
      }}>
        <BillingPage />
      </div>
    </AppShell>
  );
}