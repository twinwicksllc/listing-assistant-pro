/**
 * AdminPage2 — v2 styled wrapper
 */
import AdminPage from "@/pages/AdminPage";
import AppShell from "@/v2/components/AppShell";

export default function AdminPage2() {
  return (
    <AppShell>
      <div
        style={{
          minHeight: "100vh",
          background:
            "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
          backgroundAttachment: "fixed",
        }}
      >
        <AdminPage />
      </div>
    </AppShell>
  );
}
