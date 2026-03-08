import { useState } from "react";
import { HelpCircle, X, Bug, Lightbulb, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

type TicketType = "bug" | "feature";

export default function SupportModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TicketType>("bug");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedSubject = subject.trim();
    const trimmedDesc = description.trim();

    if (!trimmedSubject || trimmedSubject.length > 200) {
      toast({ title: "Subject is required (max 200 chars)", variant: "destructive" });
      return;
    }
    if (trimmedDesc.length > 2000) {
      toast({ title: "Description too long (max 2000 chars)", variant: "destructive" });
      return;
    }
    if (!user) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.from("support_tickets" as any).insert({
        user_id: user.id,
        type,
        subject: trimmedSubject,
        description: trimmedDesc,
      } as any);

      if (error) throw error;

      toast({ title: "Ticket submitted!", description: "We'll get back to you soon." });
      setSubject("");
      setDescription("");
      setType("bug");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to submit", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Only show for authenticated users
  if (!user) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-5 z-40 w-11 h-11 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        aria-label="Support"
      >
        <HelpCircle className="w-5 h-5" />
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 shadow-xl animate-in slide-in-from-bottom-4 duration-200 mx-4 mb-0 sm:mb-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-foreground">Support</h2>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Type selector */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setType("bug")}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                    type === "bug"
                      ? "bg-destructive/10 border-destructive/30 text-destructive"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Bug className="w-4 h-4" />
                  Bug Report
                </button>
                <button
                  type="button"
                  onClick={() => setType("feature")}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                    type === "feature"
                      ? "bg-accent/10 border-accent/30 text-accent-foreground"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Lightbulb className="w-4 h-4" />
                  Feature Request
                </button>
              </div>

              {/* Subject */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  placeholder={type === "bug" ? "What went wrong?" : "What would you like to see?"}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Details (optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder="Add any additional context..."
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !subject.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {submitting ? "Sending..." : "Submit Ticket"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
