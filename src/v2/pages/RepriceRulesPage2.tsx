/**
 * RepriceRulesPage2 — v2 styled wrapper
 * All business logic preserved from original; visual system upgraded to v2 theme.
 */
import RepriceRulesPage from "@/pages/RepriceRulesPage";
import AppShell from "@/v2/components/AppShell";

// The original RepriceRulesPage contains complex dialogs and hooks that are
// self-contained. We wrap it in AppShell so it gets the sidebar nav,
// and override the page background via a global wrapper div.
export default function RepriceRulesPage2() {
  return (
    <AppShell>
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
        backgroundAttachment: "fixed",
      }}>
        <RepriceRulesPage />
      </div>
    </AppShell>
  );
}