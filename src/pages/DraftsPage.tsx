import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, FileText, Send, Loader2, DollarSign, Gavel, RadioTower, CheckCircle2 } from "lucide-react";
import { useDrafts } from "@/hooks/useDrafts";
import BottomNav from "@/components/BottomNav";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ListingDraft } from "@/types/listing";

const EBAY_TOKEN_KEY = "ebay-user-token";

export default function DraftsPage() {
  const navigate = useNavigate();
  const { isOwner } = useAuth();
  const { drafts, removeDraft, publishDraft, publishingIds, loading } = useDrafts();
  const [publishingAll, setPublishingAll] = useState(false);

  // After eBay OAuth completes the callback redirects to /drafts?publish=all
  // Auto-trigger "Publish All" when that flag is present.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("publish") === "all") {
      // Remove the query param so a page refresh doesn't re-trigger
      window.history.replaceState({}, "", "/drafts");
      const token = localStorage.getItem(EBAY_TOKEN_KEY);
      if (token && drafts.length > 0) {
        handlePublishAll(token);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts.length]);

  const getEbayToken = async (): Promise<string | null> => {
    const stored = localStorage.getItem(EBAY_TOKEN_KEY);
    if (stored) {
      // Validate token hasn't expired (5-minute buffer)
      const expiresAt = localStorage.getItem("ebay-token-expires-at");
      if (!expiresAt || Date.now() + 5 * 60 * 1000 < Number(expiresAt)) {
        return stored;
      }
      // Token expired — clear it and fall through to re-auth
      localStorage.removeItem(EBAY_TOKEN_KEY);
    }

    // Not connected — initiate eBay OAuth and come back here after
    try {
      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: { action: "get_auth_url" },
      });
      if (error || data?.error || !data?.authUrl) {
        toast.error("Failed to start eBay authorization.");
        return null;
      }
      // After OAuth, eBay redirects to /ebay/callback which will redirect to /drafts?publish=all
      localStorage.setItem("ebay_post_auth_redirect", "/drafts?publish=all");
      window.location.href = data.authUrl;
    } catch {
      toast.error("Failed to start eBay authorization.");
    }
    return null;
  };

  const handlePublishOne = async (draft: ListingDraft) => {
    const token = await getEbayToken();
    if (!token) return;
    await publishDraft(draft, token);
  };

  const handlePublishAll = async (existingToken?: string) => {
    const token = existingToken ?? await getEbayToken();
    if (!token || drafts.length === 0) return;
    setPublishingAll(true);
    let successCount = 0;
    for (const draft of [...drafts]) {
      const ok = await publishDraft(draft, token);
      if (ok) successCount++;
    }
    setPublishingAll(false);
    if (successCount > 0) {
      toast.success(`${successCount} listing${successCount !== 1 ? "s" : ""} published to eBay!`);
    }
  };

  const handleDelete = (id: string) => {
    removeDraft(id);
    toast.success("Draft deleted");
  };

  const formatLabel = (draft: ListingDraft) => {
    if (draft.listingFormat === "AUCTION") {
      const parts = [`Starting $${(draft.auctionStartPrice ?? 0).toFixed(2)}`];
      if (draft.auctionBuyItNow) parts.push(`BIN $${draft.auctionBuyItNow.toFixed(2)}`);
      return parts.join(" · ");
    }
    const price = draft.listingPrice ?? 0;
    return price > 0 ? `$${price.toFixed(2)}` : "No price set";
  };

  const readyCount = drafts.filter(
    (d) => (d.listingFormat === "FIXED_PRICE" ? (d.listingPrice ?? 0) > 0 : (d.auctionStartPrice ?? 0) > 0)
  ).length;

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-12 pb-4">
        <h1 className="text-lg font-bold text-foreground">Staged Drafts</h1>
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${drafts.length} item${drafts.length !== 1 ? "s" : ""} staged`
            + (readyCount > 0 && readyCount < drafts.length ? ` · ${readyCount} ready to publish` : "")}
        </p>
      </header>

      {/* Publish All banner */}
      {isOwner && drafts.length > 0 && (
        <div className="px-4 mb-4 max-w-lg mx-auto">
          <button
            onClick={() => handlePublishAll()}
            disabled={publishingAll || publishingIds.size > 0}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {publishingAll ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Publishing {drafts.length} item{drafts.length !== 1 ? "s" : ""}…
              </>
            ) : (
              <>
                <RadioTower className="w-4 h-4" />
                Publish All {drafts.length} to eBay
              </>
            )}
          </button>
        </div>
      )}

      <div className="px-4 space-y-3 max-w-lg mx-auto">
        {!loading && drafts.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">No staged drafts. Capture an item to get started!</p>
            <button
              onClick={() => navigate("/home")}
              className="mx-auto mt-1 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <FileText className="w-3.5 h-3.5" /> Capture an item
            </button>
          </div>
        )}

        {drafts.map((draft) => {
          const isPublishing = publishingIds.has(draft.id);
          const hasPrice = draft.listingFormat === "AUCTION"
            ? (draft.auctionStartPrice ?? 0) > 0
            : (draft.listingPrice ?? 0) > 0;

          return (
            <div key={draft.id} className="bg-card border border-border rounded-xl p-3 flex gap-3">
              <img
                src={draft.imageUrl}
                alt={draft.title}
                className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">{draft.title}</p>

                {/* Format badge + price */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                    draft.listingFormat === "AUCTION"
                      ? "bg-orange-500/10 text-orange-500"
                      : "bg-primary/10 text-primary"
                  }`}>
                    {draft.listingFormat === "AUCTION"
                      ? <><Gavel className="w-2.5 h-2.5" /> Auction</>
                      : <><DollarSign className="w-2.5 h-2.5" /> Buy It Now</>}
                  </span>
                  <span className={`text-xs font-medium ${hasPrice ? "text-foreground" : "text-destructive"}`}>
                    {formatLabel(draft)}
                  </span>
                </div>

                {draft.imageUrls && draft.imageUrls.length > 1 && (
                  <p className="text-[10px] text-muted-foreground">{draft.imageUrls.length} photos</p>
                )}
                {draft.consignor && (
                  <p className="text-xs text-primary">Consignor: {draft.consignor}</p>
                )}
                <p className="text-xs text-muted-foreground">{draft.createdAt.toLocaleDateString()}</p>

                {/* Per-item actions */}
                {isOwner && (
                  <div className="flex gap-1.5 pt-0.5">
                    <button
                      onClick={() => handlePublishOne(draft)}
                      disabled={isPublishing || publishingAll}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      {isPublishing ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Publishing…</>
                      ) : (
                        <><Send className="w-3 h-3" /> Publish</>
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(draft.id)}
                      disabled={isPublishing}
                      className="p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              {!isOwner && (
                <button
                  onClick={() => handleDelete(draft.id)}
                  className="self-start p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <BottomNav />
    </div>
  );
}

