import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import LegalFooter from "@/components/LegalFooter";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 py-12">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Last updated: October 5, 2026
        </p>

        <div className="prose prose-sm max-w-none space-y-6 text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3">
          <h2>1. Information We Collect</h2>
          <p>
            <strong>Account Data:</strong> Email address, display name, and
            authentication credentials (passwords are hashed and never stored in
            plain text).
          </p>
          <p>
            <strong>Usage Data:</strong> Pages visited, features used,
            timestamps, device type, and browser information.
          </p>
          <p>
            <strong>Content Data:</strong> Photos, item descriptions, pricing
            data, and consignor information you upload to the Service.
          </p>
          <p>
            <strong>Payment Data:</strong> Billing information is collected and
            processed by Stripe. We store only your Stripe customer ID and
            subscription status — never your full card number.
          </p>
          <p>
            <strong>Third-Party Data:</strong> eBay API tokens, your listing,
            order and sales data retrieved through eBay's APIs on your behalf,
            and comparable-listing and market price data.
          </p>

          <h2>2. How We Use Your Data</h2>
          <p>
            We use your data to: (a) provide and improve the Service; (b)
            process payments via Stripe; (c) communicate account-related
            information; (d) analyze usage patterns to improve features; (e)
            comply with legal obligations.
          </p>

          <h2>3. Stripe Payment Processing</h2>
          <p>
            Payment processing is handled by Stripe, Inc. Stripe's collection
            and use of your payment data is governed by the{" "}
            <a
              href="https://stripe.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Stripe Privacy Policy
            </a>
            . When you provide payment information, it is transmitted directly
            to Stripe's PCI-DSS compliant servers. Sovereign Listing Suite does
            not have access to your full card details.
          </p>

          <h2>4. eBay Data Usage</h2>
          <p>
            When you connect your eBay account, we access the eBay API to: (a)
            publish and manage listings; (b) retrieve your own order and sales
            data, and comparable active listings for pricing analysis; (c) fetch
            category and item-specifics metadata. eBay API tokens are stored
            encrypted in our database. We do not sell your eBay data, and we
            share it only with the processors listed in Section 10. You may
            disconnect your eBay account at any time, after which we will cease
            accessing eBay data on your behalf and delete stored tokens within
            30 days.
          </p>
          <p>
            <strong>Comparable-listing data:</strong> To suggest prices for your
            listings, we look up similar listings on eBay. For each of your
            listings we keep the item IDs of those comparable listings and
            summary prices (average, minimum, maximum and median). This data is
            used only for your own account and is refreshed about every 24
            hours. It is deleted when an inventory sync confirms that the
            listing has ended.
          </p>
          <p>
            <strong>Market sold-price data:</strong> For market research and
            price recommendations, we also read publicly visible sold-listing
            search pages on eBay's website through a third-party reading service
            (Jina AI) to estimate recent sold counts and prices. Only the search
            terms, such as an item title, are sent to that service. Your eBay
            account details and tokens are never sent, and this data comes from
            public pages, not from your eBay account.
          </p>
          <p>
            <strong>eBay account deletion:</strong> When an eBay user asks eBay
            to delete their personal data or close their account, eBay notifies
            us. On receiving a verified notice, we delete the eBay-derived data
            we hold for that user: active-listing inventory, comparable-listing
            data, financial records, edit history, optimization history, and
            stored eBay tokens. This does not delete your ListrAssistr account,
            drafts, or other user-authored content. To request deletion of your
            account, see Sections 5, 6 and 8.
          </p>

          <h2>5. GDPR Compliance (EU/EEA Users)</h2>
          <p>
            If you are in the EU or EEA, you have the following rights under the
            General Data Protection Regulation:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Right of Access:</strong> Request a copy of your personal
              data.
            </li>
            <li>
              <strong>Right to Rectification:</strong> Request correction of
              inaccurate data.
            </li>
            <li>
              <strong>Right to Erasure:</strong> Request deletion of your
              personal data ("right to be forgotten").
            </li>
            <li>
              <strong>Right to Restrict Processing:</strong> Request limitation
              of how we process your data.
            </li>
            <li>
              <strong>Right to Data Portability:</strong> Receive your data in a
              structured, machine-readable format.
            </li>
            <li>
              <strong>Right to Object:</strong> Object to processing based on
              legitimate interests.
            </li>
          </ul>
          <p>
            Our legal bases for processing are: contract performance (providing
            the Service), legitimate interests (improving our platform), and
            consent (where applicable, such as cookies). To exercise your
            rights, contact{" "}
            <span className="text-primary">privacy@twin-wicks.com</span>.
          </p>

          <h2>6. CCPA Compliance (California Residents)</h2>
          <p>
            Under the California Consumer Privacy Act, California residents have
            the right to: (a) know what personal information is collected; (b)
            request deletion of personal information; (c) opt out of the sale of
            personal information.{" "}
            <strong>
              Sovereign Listing Suite does not sell personal information.
            </strong>{" "}
            To submit a CCPA request, contact{" "}
            <span className="text-primary">privacy@twin-wicks.com</span>.
          </p>

          <h2>7. Cookies &amp; Tracking</h2>
          <p>
            We use essential cookies for authentication and session management.
            We may use analytics cookies to understand usage patterns. You can
            manage cookie preferences through the consent banner shown on your
            first visit. Essential cookies cannot be disabled as they are
            necessary for the Service to function.
          </p>

          <h2>8. Data Retention</h2>
          <p>
            We retain your account data for as long as your account is active.
            Usage data is retained for up to 24 months. Upon account deletion,
            personal data is purged within 30 days, except where retention is
            required by law.
          </p>

          <h2>9. Data Security</h2>
          <p>
            We employ industry-standard security measures including encryption
            in transit (TLS), encryption at rest, row-level security policies on
            our database, and regular security audits. Despite these measures,
            no method of electronic storage is 100% secure.
          </p>

          <h2>10. Third-Party Services</h2>
          <p>
            We share data with the following third-party processors: Stripe
            (payments), eBay (marketplace integration), Google (AI analysis of
            the photos and text you submit), Jina AI (reading public eBay search
            pages, as described in Section 4), and our cloud infrastructure
            provider. Each processor is bound by data processing agreements that
            comply with applicable data protection laws.
          </p>
          <p>
            <strong>Google (AI analysis).</strong> The photos, item details and
            voice notes you submit for analysis are sent to Google's Gemini API.
            We use Google's paid service terms, under which Google states that
            it does not use your prompts or the content it generates to train or
            improve its models, and that they are not reviewed by human
            reviewers except to investigate security incidents, address
            suspected abuse, or comply with legal obligations. Google may
            temporarily store and process this content to detect and prevent
            abuse. Google's handling of that content is governed by its own
            terms. Please do not submit sensitive personal information, or
            personal information about children, that is not needed to create a
            listing.
          </p>

          <h2>11. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy periodically. We will notify you
            of material changes via email or in-app notification. The "Last
            updated" date at the top reflects the most recent revision.
          </p>

          <h2>12. Contact</h2>
          <p>
            For privacy inquiries or data requests, contact us at{" "}
            <span className="text-primary">privacy@twin-wicks.com</span>.
          </p>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
