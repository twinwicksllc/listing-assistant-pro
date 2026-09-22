import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  useListingEditor,
  type EditorListingRef,
} from "@/hooks/useListingEditor";
import CogsInput from "@/components/CogsInput";

interface ListingEditorModalProps {
  open: boolean;
  onClose: () => void;
  listing: EditorListingRef | null;
  ebayUrl?: string | null;
  userId: string | null | undefined;
  userToken: string | null | undefined;
  onSaved?: () => void;
}

interface EditLogRow {
  id: string;
  created_at: string;
  fields_changed: string[];
  success: boolean;
  error_message: string | null;
}

function HistoryTab({ listing }: { listing: EditorListingRef }) {
  const [rows, setRows] = useState<EditLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let query = supabase
        .from("listing_edits_log")
        .select("id, created_at, fields_changed, success, error_message")
        .order("created_at", { ascending: false })
        .limit(25);
      query = listing.listingId
        ? query.eq("ebay_listing_id", listing.listingId)
        : query.eq("ebay_sku", listing.sku);
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        console.warn("[ListingEditorModal] history fetch failed:", error);
      } else {
        setRows(data ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [listing.listingId, listing.sku]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading history...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No edits recorded yet for this listing.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-start justify-between border border-border rounded-lg px-3 py-2 text-sm"
        >
          <div>
            <div className="font-medium">
              {row.fields_changed.length > 0
                ? row.fields_changed.join(", ")
                : "No fields changed"}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(row.created_at).toLocaleString()}
            </div>
            {!row.success && row.error_message && (
              <div className="text-xs text-red-500 mt-1">
                {row.error_message}
              </div>
            )}
          </div>
          <Badge variant={row.success ? "default" : "destructive"}>
            {row.success ? "Saved" : "Failed"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

export default function ListingEditorModal({
  open,
  onClose,
  listing,
  ebayUrl,
  userId,
  userToken,
  onSaved,
}: ListingEditorModalProps) {
  const editor = useListingEditor({ userId, userToken });
  const {
    editorState,
    isLoading,
    isSaving,
    dirtyFields,
    loadListing,
    updateField,
    saveChanges,
    discardChanges,
    onCategoryChange,
    categoryAspects,
    allowedConditions,
  } = editor;

  useEffect(() => {
    if (open && listing) {
      void loadListing(listing);
    }
  }, [open, listing, loadListing]);

  const handleClose = () => {
    if (dirtyFields.size > 0) {
      discardChanges();
    }
    onClose();
  };

  const handleSave = async () => {
    const result = await saveChanges();
    if (result.success) {
      onSaved?.();
      if (result.warnings.length > 0) {
        result.warnings.forEach((w) => toast.warning(w));
      }
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && handleClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {listing?.title || "Edit Listing"}
            {ebayUrl && (
              <a
                href={ebayUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
              >
                View on eBay <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </SheetTitle>
          {listing?.sku && (
            <p className="text-xs text-muted-foreground">SKU: {listing.sku}</p>
          )}
        </SheetHeader>

        {isLoading || !editorState ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading listing
            details...
          </div>
        ) : (
          <>
            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="overview" className="text-xs">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="pricing" className="text-xs">
                  Pricing
                </TabsTrigger>
                <TabsTrigger value="attributes" className="text-xs">
                  Attributes
                </TabsTrigger>
                <TabsTrigger value="details" className="text-xs">
                  Details
                </TabsTrigger>
                <TabsTrigger value="history" className="text-xs">
                  History
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="editor-title">Title</Label>
                  <Input
                    id="editor-title"
                    value={editorState.title}
                    maxLength={80}
                    onChange={(e) => updateField("title", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {editorState.title.length}/80 chars
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="editor-description">Description</Label>
                  <Textarea
                    id="editor-description"
                    rows={6}
                    value={editorState.description}
                    onChange={(e) => updateField("description", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Condition</Label>
                    <Select
                      value={editorState.condition ?? undefined}
                      onValueChange={(v) => updateField("condition", v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select condition" />
                      </SelectTrigger>
                      <SelectContent>
                        {allowedConditions.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="editor-condition-notes">
                      Condition Notes
                    </Label>
                    <Input
                      id="editor-condition-notes"
                      value={editorState.conditionDescription}
                      onChange={(e) =>
                        updateField("conditionDescription", e.target.value)
                      }
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="pricing" className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="editor-price">Price ($)</Label>
                    <Input
                      id="editor-price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={editorState.price ?? ""}
                      onChange={(e) =>
                        updateField(
                          "price",
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="editor-quantity">Quantity</Label>
                    <Input
                      id="editor-quantity"
                      type="number"
                      min="0"
                      value={editorState.quantity ?? ""}
                      onChange={(e) =>
                        updateField(
                          "quantity",
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                </div>

                <div className="border border-border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="editor-best-offer">
                      Best Offer Enabled
                    </Label>
                    <Switch
                      id="editor-best-offer"
                      checked={editorState.bestOfferEnabled}
                      onCheckedChange={(v) =>
                        updateField("bestOfferEnabled", v)
                      }
                    />
                  </div>
                  {editorState.bestOfferEnabled && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="editor-boap">Auto-Accept Price</Label>
                        <Input
                          id="editor-boap"
                          type="number"
                          step="0.01"
                          value={editorState.bestOfferAutoAcceptPrice ?? ""}
                          onChange={(e) =>
                            updateField(
                              "bestOfferAutoAcceptPrice",
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="editor-bodp">Auto-Decline Price</Label>
                        <Input
                          id="editor-bodp"
                          type="number"
                          step="0.01"
                          value={editorState.bestOfferAutoDeclinePrice ?? ""}
                          onChange={(e) =>
                            updateField(
                              "bestOfferAutoDeclinePrice",
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                <CogsInput
                  cogs={editorState.cogs ?? undefined}
                  listingPrice={editorState.price ?? 0}
                  onChange={(v) => updateField("cogs", v ?? null)}
                />
              </TabsContent>

              <TabsContent value="attributes" className="mt-4 space-y-3">
                {categoryAspects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No item specifics available for this category.
                  </p>
                ) : (
                  categoryAspects.map((aspect) => (
                    <div key={aspect.name} className="space-y-1.5">
                      <Label className="flex items-center gap-2">
                        {aspect.name}
                        <Badge
                          variant={aspect.required ? "default" : "outline"}
                          className="text-[10px]"
                        >
                          {aspect.required ? "Required" : "Optional"}
                        </Badge>
                      </Label>
                      <Input
                        value={editorState.itemSpecifics[aspect.name] ?? ""}
                        onChange={(e) =>
                          updateField("itemSpecifics", {
                            ...editorState.itemSpecifics,
                            [aspect.name]: e.target.value,
                          })
                        }
                      />
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="details" className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="editor-category">eBay Category ID</Label>
                  <Input
                    id="editor-category"
                    value={editorState.categoryId ?? ""}
                    onChange={(e) => void onCategoryChange(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Changing category refreshes attributes and allowed
                    conditions — verify carefully before saving.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="history" className="mt-4">
                {listing && <HistoryTab listing={listing} />}
              </TabsContent>
            </Tabs>

            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {dirtyFields.size > 0
                  ? `${dirtyFields.size} unsaved change${dirtyFields.size === 1 ? "" : "s"}`
                  : "No unsaved changes"}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={discardChanges}
                  disabled={dirtyFields.size === 0 || isSaving}
                >
                  Discard
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={dirtyFields.size === 0 || isSaving}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
