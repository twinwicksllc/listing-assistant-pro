import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import LegalFooter from "@/components/LegalFooter";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 py-12">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: March 8, 2026</p>

        <div className="prose prose-sm max-w-none space-y-6 text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3">
          <h2>1. Information We Collect</h2>
          <p><strong>Account Data:</strong> Email address, display name, and authentication credentials (passwords are hashed and never stored in plain text).</p>
          <p><strong>Usage Data:</strong> Pages visited, features used, timestamps, device type, and browser information.</p>
          <p><strong>Content Data:</strong> Photos, item descriptions, pricing data, and consignor information you upload to the Service.</p>
          <p><strong>Payment Data:</strong> Billing information is collected and processed by Stripe. We store only your Stripe customer ID and subscription status — never your full card number.</p>
          <p><strong>Third-Party Data:</strong> eBay API tokens, listing data, and sold-item pricing retrieved from eBay on your behalf.</p>

          <h2>2. How We Use Your Data</h2>
          <p>We use your data to: (a) provide and improve the Service; (b) process payments via Stripe; (c) communicate account-related information; (d) analyze usage patterns to improve features; (e) comply with legal obligations.</p>

          <h2>3. Stripe Payment Processing</h2>
          <p>Payment processing is handled by Stripe, Inc. Stripe's collection and use of your payment data is governed by the <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Stripe Privacy Policy</a>. When you provide payment information, it is transmitted directly to Stripe's PCI-DSS compliant servers. Teckstart does not have access to your full card details.</p>

          <h2>4. eBay Data Usage</h2>
          <p>When you connect your eBay account, we access the eBay API to: (a) publish and manage listings; (b) retrieve completed/sold item data for market pricing analysis; (c) fetch category and item-specifics metadata. eBay API tokens are stored encrypted in our database. We do not sell or share your eBay data with third parties. You may disconnect your eBay account at any time, after which we will cease accessing eBay data on your behalf and delete stored tokens within 30 days.</p>

          <h2>5. GDPR Compliance (EU/EEA Users)</h2>
          <p>If you are in the EU or EEA, you have the following rights under the General Data Protection Regulation:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Right of Access:</strong> Request a copy of your personal data.</li>
            <li><strong>Right to Rectification:</strong> Request correction of inaccurate data.</li>
            <li><strong>Right to Erasure:</strong> Request deletion of your personal data ("right to be forgotten").</li>
            <li><strong>Right to Restrict Processing:</strong> Request limitation of how we process your data.</li>
            <li><strong>Right to Data Portability:</strong> Receive your data in a structured, machine-readable format.</li>
            <li><strong>Right to Object:</strong> Object to processing based on legitimate interests.</li>
          </ul>
          <p>Our legal bases for processing are: contract performance (providing the Service), legitimate interests (improving our platform), and consent (where applicable, such as cookies). To exercise your rights, contact <span className="text-primary">privacy@teckstart.com</span>.</p>

          <h2>6. CCPA Compliance (California Residents)</h2>
          <p>Under the California Consumer Privacy Act, California residents have the right to: (a) know what personal information is collected; (b) request deletion of personal information; (c) opt out of the sale of personal information. <strong>Teckstart does not sell personal information.</strong> To submit a CCPA request, contact <span className="text-primary">privacy@teckstart.com</span>.</p>

          <h2>7. Cookies &amp; Tracking</h2>
          <p>We use essential cookies for authentication and session management. We may use analytics cookies to understand usage patterns. You can manage cookie preferences through the consent banner shown on your first visit. Essential cookies cannot be disabled as they are necessary for the Service to function.</p>

          <h2>8. Data Retention</h2>
          <p>We retain your account data for as long as your account is active. Usage data is retained for up to 24 months. Upon account deletion, personal data is purged within 30 days, except where retention is required by law.</p>

          <h2>9. Data Security</h2>
          <p>We employ industry-standard security measures including encryption in transit (TLS), encryption at rest, row-level security policies on our database, and regular security audits. Despite these measures, no method of electronic storage is 100% secure.</p>

          <h2>10. Third-Party Services</h2>
          <p>We share data with the following third-party processors: Stripe (payments), eBay (marketplace integration), and our cloud infrastructure provider. Each processor is bound by data processing agreements that comply with applicable data protection laws.</p>

          <h2>11. Changes to This Policy</h2>
          <p>We may update this Privacy Policy periodically. We will notify you of material changes via email or in-app notification. The "Last updated" date at the top reflects the most recent revision.</p>

          <h2>12. Contact</h2>
          <p>For privacy inquiries or data requests, contact us at <span className="text-primary">privacy@teckstart.com</span>.</p>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
