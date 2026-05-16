/**
 * AnalyzePage2 — v2 styled wrapper
 * Routes /analyze to the refactored slim orchestrator in src/pages/AnalyzePage.
 * Logic, hooks, and sub-components all live in src/pages/AnalyzePage.tsx and
 * src/components/analyze/ — edit there, not here.
 */
import AnalyzePage from "@/pages/AnalyzePage";
import AppShell from "@/v2/components/AppShell";

export default function AnalyzePage2() {
  return (
    <AppShell>
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
        backgroundAttachment: "fixed",
      }}>
        <AnalyzePage />
      </div>
    </AppShell>
  );
}
