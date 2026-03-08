import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import LegalFooter from "@/components/LegalFooter";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 py-12">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <h1 className="text-2xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: March 8, 2026</p>

        <div className="prose prose-sm max-w-none space-y-6 text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3">
          <h2>1. Acceptance of Terms</h2>
          <p>By accessing or using the Teckstart platform ("Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>

          <h2>2. Description of Service</h2>
          <p>Teckstart provides AI-powered tools for identifying, cataloging, and listing items for resale on third-party marketplaces such as eBay. The Service includes image analysis, pricing suggestions, draft management, and listing publication features.</p>

          <h2>3. User Accounts &amp; Organizations</h2>
          <p>You must create an account to use the Service. Account owners may invite team members ("Listers") who can capture and draft items. Only the account owner may publish listings or access revenue analytics. You are responsible for maintaining the confidentiality of your account credentials.</p>

          <h2>4. Payment Processing (Stripe)</h2>
          <p>All payments are processed securely through Stripe, Inc. By subscribing to a paid plan, you authorize Teckstart to charge your payment method via Stripe. We do not store your full credit card number on our servers. All payment data is handled in accordance with PCI-DSS standards. Subscription fees are billed in advance on a monthly basis and are non-refundable except as required by law. You may cancel your subscription at any time through the billing portal.</p>

          <h2>5. eBay Integration &amp; Data Usage</h2>
          <p>The Service integrates with the eBay API to publish listings and retrieve pricing data. By connecting your eBay account, you grant Teckstart permission to: (a) create, modify, and manage listings on your behalf; (b) access sold item data for pricing analysis; (c) store your eBay API tokens securely. Your use of eBay through our Service remains subject to eBay's own User Agreement and policies. Teckstart is not responsible for actions taken by eBay on your account.</p>

          <h2>6. Data Protection &amp; Privacy (GDPR/CCPA)</h2>
          <p>We are committed to protecting your personal data. We process personal data lawfully under GDPR (for EU/EEA users) and comply with CCPA (for California residents). For full details on data collection, usage, retention, and your rights, please see our <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.</p>

          <h2>7. User Content</h2>
          <p>You retain ownership of all photos, descriptions, and other content you upload. By uploading content, you grant Teckstart a limited, non-exclusive license to process, store, and transmit that content solely for the purpose of providing the Service.</p>

          <h2>8. Prohibited Conduct</h2>
          <p>You may not: (a) use the Service for any unlawful purpose; (b) attempt to reverse-engineer or exploit the Service; (c) upload content that infringes third-party intellectual property rights; (d) share account credentials with unauthorized parties.</p>

          <h2>9. Limitation of Liability</h2>
          <p>To the maximum extent permitted by law, Teckstart shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service, including but not limited to loss of profits, data, or business opportunities.</p>

          <h2>10. Modifications</h2>
          <p>We reserve the right to modify these Terms at any time. Material changes will be communicated via email or in-app notification at least 30 days before taking effect. Continued use of the Service constitutes acceptance of updated Terms.</p>

          <h2>11. Contact</h2>
          <p>For questions about these Terms, contact us at <span className="text-primary">legal@teckstart.com</span>.</p>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
