import { useState, useEffect } from "react";
import {
  X, Save, Loader2, DollarSign, Gavel, ShoppingCart, Tag,
  UserCircle, Truck, CreditCard, RotateCcw, AlertCircle, Clock,
} from "lucide-react";
import { ListingDraft, ListingFormat, AuctionDuration } from "@/types/listing";
import { useDrafts } from "@/hooks/useDrafts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface EditDraftModalProps {
  draft: ListingDraft;
  onClose: () => void;
  onSaved: (updated: ListingDraft) => void;
}

interface PolicyOption {
  id: string;
  name: string;
}

interface Policies {
  fulfillment: PolicyOption[];
  payment: PolicyOption[];
  returns: PolicyOption[];
}

// eBay-approved conditions (Inventory API)
// All conditions below are valid for most categories. Some categories (e.g., coins)
// may have restrictions and auto-correct to valid alternatives on publish.
// See: https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum
const CONDITIONS = [
  { value: "NEW",                      label: "New" },
  { value: "LIKE_NEW",                 label: "Like New" },
  { value: "NEW_OTHER",                label: "New Other (without tags)" },
  { value: "NEW_WITH_DEFECTS",         label: "New with Defects" },
  { value: "CERTIFIED_REFURBISHED",    label: "Certified Refurbished" },
  { value: "EXCELLENT_REFURBISHED",    label: "Excellent – Refurbished" },
  { value: "VERY_GOOD_REFURBISHED",    label: "Very Good – Refurbished" },
  { value: "GOOD_REFURBISHED",         label: "Good – Refurbished" },
  { value: "SELLER_REFURBISHED",       label: "Seller Refurbished" },
  { value: "PRE_OWNED_GOOD",           label: "Pre-Owned – Good" },
  { value: "PRE_OWNED_FAIR",           label: "Pre-Owned – Fair" },
  { value: "PRE_OWNED_POOR",           label: "Pre-Owned – Poor" },
  { value: "FOR_PARTS_OR_NOT_WORKING", label: "For Parts or Not Working" },
];

const AUCTION_DURATIONS: { value: AuctionDuration; label: string }[] = [
  { value: "Days_1",  label: "1 Day" },
  { value: "Days_3",  label: "3 Days" },
  { value: "Days_5",  label: "5 Days" },
  { value: "Days_7",  label: "7 Days (recommended)" },
  { value: "Days_10", label: "10 Days" },
];

export default function EditDraftModal({ draft, onClose, onSaved }: EditDraftModalProps) {
  const { updateDraft } = useDrafts();
  const { user } = useAuth();

  const [title, setTitle]               = useState(draft.title);
  const [description, setDescription]   = useState(draft.description);
  const [listingFormat, setListingFormat] = useState<ListingFormat>(draft.listingFormat ?? "FIXED_PRICE");
  // listingPrice is always saved by AnalyzePage.handleSave (never null/undefined for new drafts).
  // We use it directly. If somehow missing (very old draft), fall back to priceMin as last resort.
  const [listingPrice, setListingPrice] = useState<number>(
    draft.listingPrice != null && draft.listingPrice > 0
      ? draft.listingPrice
      : draft.priceMin ?? 0
  );
  const [auctionDuration, setAuctionDuration] = useState<AuctionDuration>(
    draft.auctionDuration ?? "Days_7"
  );
  const [condition, setCondition]       = useState(draft.condition ?? "PRE_OWNED_GOOD");
  const [consignor, setConsignor]       = useState(draft.consignor ?? "");
  const [ebayCategoryId, setEbayCategoryId] = useState(draft.ebayCategoryId ?? "");
  // Track whether the user has changed the category ID so we can clear the stale breadcrumb
  const [categoryChanged, setCategoryChanged] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState(false);
  const [itemSpecifics, setItemSpecifics] = useState<Record<string, string>>(
    (draft.itemSpecifics as Record<string, string>) ?? {}
  );

  // Policy state — seeded directly from the saved draft values so the selects
  // show the correct selection immediately, before the options list loads.
  const [policies, setPolicies]                     = useState<Policies | null>(null);
  const [policiesLoading, setPoliciesLoading]       = useState(false);
  const [policiesError, setPoliciesError]           = useState("");
  const [ebayConnected, setEbayConnected]           = useState(false);
  const [fulfillmentPolicyId, setFulfillmentPolicyId] = useState(draft.fulfillmentPolicyId ?? "");
  const [paymentPolicyId, setPaymentPolicyId]         = useState(draft.paymentPolicyId ?? "");
  const [returnPolicyId, setReturnPolicyId]           = useState(draft.returnPolicyId ?? "");

  const [saving, setSaving] = useState(false);

  const displaySpecifics = Object.entries(itemSpecifics).filter(([, v]) => v !== undefined);

  // Fetch eBay policies on mount.
  // Token lookup order mirrors usePublishDraft:
  //   1. Server-side stored token in Supabase profiles (preferred — avoids XSS risk)
  //   2. localStorage fallback for backwards compatibility
  //
  // Policies are fetched via the ebay-publish function (get_policies action) rather than
  // the separate ebay-policies function, to avoid CORS preflight issues with that function.
  useEffect(() => {
    let cancelled = false;

    const loadPolicies = async () => {
      setPoliciesLoading(true);
      setPoliciesError("");

      // 1. Try server-side stored token (requires user to be loaded)
      let ebayToken: string | null = null;
      if (user?.id) {
        try {
          const { data, error: tokenError } = await supabase.functions.invoke("ebay-publish", {
            body: { action: "get_stored_token", userId: user.id },
          });
          if (tokenError) {
            console.warn("EditDraftModal: get_stored_token error:", tokenError);
          } else if (data?.token) {
            ebayToken = data.token;
            console.log("EditDraftModal: token resolved from server-side profiles");
          } else {
            console.log("EditDraftModal: get_stored_token returned no token (noToken:", data?.noToken, ")");
          }
        } catch (e) {
          console.warn("EditDraftModal: get_stored_token threw:", e);
          // fall through to localStorage
        }
      }

      if (cancelled) return;

      // 2. Fall back to localStorage
      if (!ebayToken) {
        ebayToken = localStorage.getItem("ebay-user-token");
        if (ebayToken) {
          console.log("EditDraftModal: token resolved from localStorage fallback");
        }
      }

      if (cancelled) return;

      if (!ebayToken) {
        // No token found — eBay not connected
        setPoliciesLoading(false);
        return;
      }

      setEbayConnected(true);

      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: { action: "get_policies", userToken: ebayToken, userId: user?.id ?? null },
      });

      if (cancelled) return;

      if (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("EditDraftModal: get_policies invoke error:", detail);
        setPoliciesError(`Could not load eBay policies: ${detail}`);
      } else if (data?.error) {
        console.error("EditDraftModal: get_policies returned error:", data.error);
        setPoliciesError(`Could not load eBay policies: ${data.error}`);
      } else {
        setPolicies(data as Policies);

        if (data?.policyErrors && Object.keys(data.policyErrors).length > 0) {
          console.warn("EditDraftModal: some policy types had errors:", data.policyErrors);
        }

        // Auto-select the first policy of each type ONLY when the draft had no saved
        // policy. Use the functional updater so we never overwrite an already-set value.
        setFulfillmentPolicyId((prev) => (!prev && data.fulfillment?.length > 0) ? data.fulfillment[0].id : prev);
        setPaymentPolicyId((prev)      => (!prev && data.payment?.length > 0)    ? data.payment[0].id    : prev);
        setReturnPolicyId((prev)       => (!prev && data.returns?.length > 0)    ? data.returns[0].id    : prev);
      }

      setPoliciesLoading(false);
    };

    loadPolicies();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // When user types a new category ID, track that it differs from the saved value
  const handleCategoryIdChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "");
    setEbayCategoryId(cleaned);
    setCategoryChanged(cleaned !== (draft.ebayCategoryId ?? ""));
  };

  // Breadcrumb to display in the non-edit view:
  // - If the user changed the category ID, show "Category #<id>" (stale breadcrumb is misleading)
  // - Otherwise show the saved breadcrumb, falling back to "Category #<id>"
  const displayBreadcrumb = categoryChanged
    ? (ebayCategoryId ? `Category #${ebayCategoryId}` : "")
    : (draft.ebayCategoryBreadcrumb || (ebayCategoryId ? `Category #${ebayCategoryId}` : ""));

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title cannot be empty");
      return;
    }

    if (listingFormat === "AUCTION" && listingPrice <= 0) {
      toast.error("Please set a starting bid price for the auction");
      return;
    }

    setSaving(true);

    // When the category ID was changed, clear the stale breadcrumb in the DB so it
    // does not show misleading text from the original category going forward.
    const newCategoryId  = ebayCategoryId || undefined;
    const newBreadcrumb  = categoryChanged
      ? undefined                         // clear stale breadcrumb when ID changed
      : draft.ebayCategoryBreadcrumb;     // keep existing breadcrumb if ID unchanged

    const updates: Partial<ListingDraft> = {
      title: title.slice(0, 80),
      description,
      listingFormat,
      listingPrice,
      auctionDuration: listingFormat === "AUCTION" ? auctionDuration : undefined,
      condition,
      consignor,
      ebayCategoryId:        newCategoryId,
      ebayCategoryBreadcrumb: newBreadcrumb,
      itemSpecifics,
      fulfillmentPolicyId: fulfillmentPolicyId || undefined,
      paymentPolicyId:     paymentPolicyId     || undefined,
      returnPolicyId:      returnPolicyId      || undefined,
    };

    const ok = await updateDraft(draft.id, updates);
    setSaving(false);
    if (ok) {
      toast.success("Draft updated!");
      onSaved({ ...draft, ...updates });
      onClose();
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Sheet / Modal */}
      <div className="w-full sm:max-w-lg bg-background rounded-t-2xl sm:rounded-2xl border border-border shadow-xl flex flex-col max-h-[92dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <img
              src={draft.imageUrl}
              alt={draft.title}
              className="w-10 h-10 rounded-lg object-cover border border-border"
            />
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight line-clamp-1">{draft.title}</p>
              <p className="text-[10px] text-muted-foreground">{draft.createdAt.toLocaleDateString()}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">

          {/* Title */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">eBay Title</label>
              <span className="text-xs text-muted-foreground">{title.length}/80</span>
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Listing Format + Price */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-primary" />
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Listing Format & Price</label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setListingFormat("FIXED_PRICE")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                  listingFormat === "FIXED_PRICE"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
                }`}
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                Buy It Now
              </button>
              <button
                onClick={() => setListingFormat("AUCTION")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                  listingFormat === "AUCTION"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
                }`}
              >
                <Gavel className="w-3.5 h-3.5" />
                Auction
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {listingFormat === "AUCTION" ? "Starting Bid ($)" : "Listing Price ($)"}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={listingPrice || ""}
                placeholder="0.00"
                onChange={(e) => setListingPrice(parseFloat(e.target.value) || 0)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Auction Duration — only shown for AUCTION format */}
            {listingFormat === "AUCTION" && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                  <label className="text-xs text-muted-foreground font-medium">Auction Duration</label>
                </div>
                <div className="bg-card border border-border rounded-lg divide-y divide-border">
                  {AUCTION_DURATIONS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setAuctionDuration(d.value)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                        auctionDuration === d.value
                          ? "text-primary font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span>{d.label}</span>
                      {auctionDuration === d.value && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  eBay requires an explicit duration for auction listings (1, 3, 5, 7, or 10 days).
                </p>
              </div>
            )}
          </div>

          {/* eBay Category */}
          <div className="bg-muted/50 rounded-lg px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">eBay Category</p>
            </div>
            {customCategoryInput ? (
              <div className="space-y-1.5">
                <input
                  autoFocus
                  type="text"
                  value={ebayCategoryId}
                  onChange={(e) => handleCategoryIdChange(e.target.value)}
                  placeholder="Enter eBay category ID (e.g. 261069)"
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setCustomCategoryInput(false)}
                    className="flex-1 text-xs py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {ebayCategoryId ? (
                    <>
                      {/* displayBreadcrumb reflects any unsaved category change live */}
                      <p className="text-xs text-foreground leading-snug">{displayBreadcrumb}</p>
                      <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">ID: {ebayCategoryId}</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No category set</p>
                  )}
                </div>
                <button
                  onClick={() => setCustomCategoryInput(true)}
                  className="flex-shrink-0 text-[10px] text-primary hover:underline"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Item Specifics */}
          {displaySpecifics.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-primary" />
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Item Specifics</label>
              </div>
              <div className="bg-card border border-border rounded-lg divide-y divide-border">
                {displaySpecifics.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">{key}</span>
                    <input
                      value={value ?? ""}
                      onChange={(e) =>
                        setItemSpecifics((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="text-xs text-foreground text-right bg-transparent border-none focus:outline-none focus:ring-0 max-w-[55%]"
                    />
                  </div>
                ))}
              </div>

              {/* Condition */}
              <div className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">Condition</span>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="text-xs text-foreground bg-transparent border-none focus:outline-none cursor-pointer text-right"
                >
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Condition (standalone if no item specifics) */}
          {displaySpecifics.length === 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Condition</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Consignor */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <UserCircle className="w-3.5 h-3.5 text-primary" />
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Consignor</label>
              <span className="text-[10px] text-muted-foreground/60 ml-auto">Optional</span>
            </div>
            <input
              value={consignor}
              onChange={(e) => setConsignor(e.target.value)}
              placeholder="Who does this item belong to?"
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* eBay Business Policies */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5 text-primary" />
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">eBay Business Policies</label>
              {policiesLoading && (
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />
              )}
            </div>

            {policiesError && (
              <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{policiesError}</p>
              </div>
            )}

            {!policiesError && !policiesLoading && !ebayConnected && (
              <div className="flex items-start gap-2 bg-muted/50 border border-border rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">Connect your eBay account in Settings to manage policies.</p>
              </div>
            )}

            {/* Render policy selects as soon as eBay is connected — even while the options
                list is still loading. This prevents the "flash of nothing selected" that
                occurred when the block was gated on `policies !== null`:
                - While loading: show "Loading…" text in place of the select
                - Once loaded: render the select with the saved value already highlighted   */}
            {ebayConnected && (
              <div className="bg-card border border-border rounded-lg divide-y divide-border">

                {/* Fulfillment / Shipping */}
                <div className="flex items-center justify-between px-3 py-2.5 gap-3">
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Truck className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Shipping</span>
                  </div>
                  {policiesLoading ? (
                    <span className="text-xs text-muted-foreground italic">Loading…</span>
                  ) : policies && policies.fulfillment.length === 0 ? (
                    <span className="text-xs text-destructive">No policies found</span>
                  ) : (
                    <select
                      value={fulfillmentPolicyId}
                      onChange={(e) => setFulfillmentPolicyId(e.target.value)}
                      className="text-xs text-foreground bg-transparent border-none focus:outline-none cursor-pointer text-right max-w-[60%] truncate"
                    >
                      <option value="">— Select —</option>
                      {(policies?.fulfillment ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Payment */}
                <div className="flex items-center justify-between px-3 py-2.5 gap-3">
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Payment</span>
                  </div>
                  {policiesLoading ? (
                    <span className="text-xs text-muted-foreground italic">Loading…</span>
                  ) : policies && policies.payment.length === 0 ? (
                    <span className="text-xs text-destructive">No policies found</span>
                  ) : (
                    <select
                      value={paymentPolicyId}
                      onChange={(e) => setPaymentPolicyId(e.target.value)}
                      className="text-xs text-foreground bg-transparent border-none focus:outline-none cursor-pointer text-right max-w-[60%] truncate"
                    >
                      <option value="">— Select —</option>
                      {(policies?.payment ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Returns */}
                <div className="flex items-center justify-between px-3 py-2.5 gap-3">
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Returns</span>
                  </div>
                  {policiesLoading ? (
                    <span className="text-xs text-muted-foreground italic">Loading…</span>
                  ) : policies && policies.returns.length === 0 ? (
                    <span className="text-xs text-destructive">No policies found</span>
                  ) : (
                    <select
                      value={returnPolicyId}
                      onChange={(e) => setReturnPolicyId(e.target.value)}
                      className="text-xs text-foreground bg-transparent border-none focus:outline-none cursor-pointer text-right max-w-[60%] truncate"
                    >
                      <option value="">— Select —</option>
                      {(policies?.returns ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>

              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="px-4 pb-6 pt-3 border-t border-border flex-shrink-0">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : (
              <><Save className="w-4 h-4" /> Save Changes</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}