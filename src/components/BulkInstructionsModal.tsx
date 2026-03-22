import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Map,
  Sparkles,
  Send,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle2,
  X,
} from "lucide-react";

interface BulkInstructionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function BulkInstructionsModal({ open, onOpenChange }: BulkInstructionsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Bulk Listing Guide</DialogTitle>
          <DialogDescription className="text-base">
            How to create 10–1,000 eBay listings at once with CSV/Excel files
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 4-Step Overview */}
          <section>
            <h3 className="font-semibold text-lg flex items-center gap-2 mb-3">
              <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-sm">4</span>
              Quick Steps
            </h3>
            <div className="grid grid-cols-4 gap-3 text-sm">
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Upload className="w-5 h-5" />
                </div>
                <span className="font-medium">Upload</span>
                <span className="text-xs text-muted-foreground">CSV/Excel or template</span>
              </div>
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Map className="w-5 h-5" />
                </div>
                <span className="font-medium">Map</span>
                <span className="text-xs text-muted-foreground">Match columns to fields</span>
              </div>
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Sparkles className="w-5 h-5" />
                </div>
                <span className="font-medium">Review</span>
                <span className="text-xs text-muted-foreground">Generate AI descriptions</span>
              </div>
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Send className="w-5 h-5" />
                </div>
                <span className="font-medium">Publish</span>
                <span className="text-xs text-muted-foreground">Batch to eBay</span>
              </div>
            </div>
          </section>

          {/* Photo Instructions */}
          <section className="bg-muted/50 rounded-lg p-4 border border-border">
            <h3 className="font-semibold flex items-center gap-2 mb-3 text-amber-600">
              <ImageIcon className="w-5 h-5" />
              Photos — Important!
            </h3>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                <strong>Photos use public URLs only</strong> — you cannot upload photos directly in bulk.
                Provide image URLs in your CSV/Excel file.
              </p>

              <div className="space-y-2">
                <p className="font-medium text-foreground">Option A: Comma-separated URLs (recommended)</p>
                <code className="block bg-background border border-border rounded px-3 py-2 text-xs">
                  imageUrls: https://site.com/img1.jpg,https://site.com/img2.jpg,https://site.com/img3.jpg
                </code>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-foreground">Option B: Separate columns (auto-detected)</p>
                <code className="block bg-background border border-border rounded px-3 py-2 text-xs">
                  imageUrl1: https://site.com/img1.jpg<br />
                  imageUrl2: https://site.com/img2.jpg<br />
                  image3: https://site.com/img3.jpg
                </code>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium mb-1">Common photo sources:</p>
                    <ul className="space-y-0.5 list-disc list-inside text-muted-foreground">
                      <li>Your own AWS S3, Cloudflare R2, or cloud storage</li>
                      <li>Supplier/vendor-provided CSVs with image URLs</li>
                      <li>Relisting existing eBay items (URLs are persistent)</li>
                    </ul>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                URLs must start with <code className="bg-background px-1 rounded">http://</code> or <code className="bg-background px-1 rounded">https://</code>
                &nbsp;• Max 8 images per listing
              </p>
            </div>
          </section>

          {/* CSV Format */}
          <section>
            <h3 className="font-semibold flex items-center gap-2 mb-3">
              <Upload className="w-5 h-5" />
              CSV/Excel Format
            </h3>
            <div className="bg-background border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Column</th>
                    <th className="px-3 py-2 text-left font-medium">Required?</th>
                    <th className="px-3 py-2 text-left font-medium">Aliases</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr><td className="px-3 py-2 font-mono text-xs">title</td><td className="px-3 py-2"><span className="text-red-500">✗ Required</span></td><td className="px-3 py-2 text-muted-foreground text-xs">listingtitle, productname, item</td></tr>
                  <tr><td className="px-3 py-2 font-mono text-xs">price</td><td className="px-3 py-2"><span className="text-red-500">✗ Required</span></td><td className="px-3 py-2 text-muted-foreground text-xs">listingprice, butitnowprice, binprice</td></tr>
                  <tr><td className="px-3 py-2 font-mono text-xs">categoryId</td><td className="px-3 py-2"><span className="text-red-500">✗ Required</span></td><td className="px-3 py-2 text-muted-foreground text-xs">category, ebaycat, categoryid</td></tr>
                  <tr><td className="px-3 py-2 font-mono text-xs">condition</td><td className="px-3 py-2"><span className="text-red-500">✗ Required</span></td><td className="px-3 py-2 text-muted-foreground text-xs">itemcondition</td></tr>
                  <tr><td className="px-3 py-2 font-mono text-xs">quantity</td><td className="px-3 py-2"><span className="text-green-500">✓ Optional</span></td><td className="px-3 py-2 text-muted-foreground text-xs">qty, stock (default: 1)</td></tr>
                  <tr><td className="px-3 py-2 font-mono text-xs">description</td><td className="px-3 py-2"><span className="text-green-500">✓ Optional</span></td><td className="px-3 py-2 text-muted-foreground text-xs">desc, itemdescription</td></tr>
                  <tr><td className="px-3 py-2 font-mono text-xs">imageUrls</td><td className="px-3 py-2"><span className="text-green-500">✓ Optional</span></td><td className="px-3 py-2 text-muted-foreground text-xs">images, photos, imageUrl1-8</td></tr>
                  <tr><td className="px-3 py-2 font-mono text-xs">cogs</td><td className="px-3 py-2"><span className="text-green-500">✓ Optional</span></td><td className="px-3 py-2 text-muted-foreground text-xs">cost, purchaseprice</td></tr>
                  <tr><td className="px-3 py-2 font-mono text-xs">consignor</td><td className="px-3 py-2"><span className="text-green-500">✓ Optional</span></td><td className="px-3 py-2 text-muted-foreground text-xs">owner, seller</td></tr>
                  <tr><td className="px-3 py-2 font-mono text-xs">itemSpecific_*</td><td className="px-3 py-2"><span className="text-green-500">✓ Optional</span></td><td className="px-3 py-2 text-muted-foreground text-xs">itemSpecificBrand, itemSpecificSize, etc.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Plan Limits */}
          <section>
            <h3 className="font-semibold flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5" />
              Plan Limits
            </h3>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-muted/50 border border-border rounded-lg p-3">
                <p className="font-medium">Starter</p>
                <p className="text-xs text-muted-foreground mt-1">5 AI desc / 5 publish</p>
              </div>
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                <p className="font-medium text-primary">Pro</p>
                <p className="text-xs text-muted-foreground mt-1">25 AI desc / 50 publish</p>
              </div>
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                <p className="font-medium text-primary">Unlimited</p>
                <p className="text-xs text-muted-foreground mt-1">1,000 AI desc / 1,000 publish</p>
              </div>
            </div>
          </section>

          {/* Tips */}
          <section className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-3 text-blue-700 dark:text-blue-300">
              <Sparkles className="w-5 h-5" />
              Pro Tips
            </h3>
            <ul className="space-y-2 text-sm text-blue-900 dark:text-blue-100">
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>Use templates to get started fast — they have sample rows and pre-configured columns</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>Column auto-detection handles common aliases (e.g., "SKU", "Item SKU", "sku" all work)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>Generate AI descriptions after mapping columns — they're tailored to each row's data</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>Download error reports after publishing to fix failed listings</span>
              </li>
            </ul>
          </section>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Got it, let's go!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}