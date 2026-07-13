import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  Camera, Sparkles, TrendingUp, Shield, Zap, ChevronRight,
  Star, Check, ArrowRight, Upload, Search, FileText
} from "lucide-react";
import teckstartLogo from "@/assets/teckstart-logo.png";
import { ThemeToggle } from "@/components/ThemeToggle";

// Animated counter hook
function useCounter(target: number, duration: number = 1500, start: boolean = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, start]);
  return count;
}

// Intersection observer hook
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, inView };
}

const FEATURES = [
  {
    icon: Camera,
    title: "Photo-First Identification",
    desc: "Upload photos from any angle. The system identifies your item — coins, collectibles, electronics, jewelry, clothing, and more — and pulls the details that matter for a strong listing.",
  },
  {
    icon: FileText,
    title: "Complete Listing Generation",
    desc: "Receive a fully-formed eBay listing: an 80-character SEO title, detailed description, item specifics, and the correct leaf category — ready to review and publish.",
  },
  {
    icon: Search,
    title: "Live Competitor Pricing",
    desc: "Real-time eBay sold listing data surfaces current market comps so you set a price grounded in what buyers are actually paying — not instinct.",
  },
  {
    icon: Shield,
    title: "Melt Value Protection",
    desc: "Live gold, silver, and platinum spot prices are checked automatically. Precious metal items are never listed below their intrinsic melt value.",
  },
  {
    icon: TrendingUp,
    title: "Agentic Market Grounding",
    desc: "Before generating your listing, the system searches the current market in real time — verifying category, pricing trends, and item-specific value factors like mint marks, grades, and variants.",
  },
  {
    icon: Zap,
    title: "One-Tap eBay Publishing",
    desc: "Push directly to eBay as a draft listing. Review in the eBay app or desktop before going live — no copy-pasting, no reformatting.",
  },
];

const STEPS = [
  { num: "01", title: "Upload Photos", desc: "Take photos or upload images of your item. Add a voice note for additional context if needed." },
  { num: "02", title: "Review the Analysis", desc: "The system identifies the item, researches current market pricing, and generates a complete eBay listing in seconds." },
  { num: "03", title: "Publish to eBay", desc: "Approve the listing as-is or make quick edits, then push directly to eBay as a draft — ready to go live." },
];

const PLANS = [
  {
    name: "Free",
    price: "Free",
    annualPrice: "Free",
    period: "",
    annualPeriod: "",
    features: ["6 listings / month", "Photo identification", "Draft saving"],
    cta: "Get Started Free",
    highlight: false,
  },
  {
    name: "Starter",
    price: "$19",
    annualPrice: "$190",
    period: "/mo",
    annualPeriod: "/yr",
    annualNote: "~$15.83/mo",
    features: ["25 listings / month", "Full listing generation", "eBay publishing", "Draft saving"],
    cta: "Start Listing",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$49",
    annualPrice: "$490",
    period: "/mo",
    annualPeriod: "/yr",
    annualNote: "~$40.83/mo",
    features: ["200 listings / month", "Full AI enhancement", "Voice notes", "Melt value protection", "Competitor pricing"],
    cta: "Go Pro",
    highlight: true,
    badge: "Most Popular",
  },
  {
    name: "Shop",
    price: "$99",
    annualPrice: "$990",
    period: "/mo",
    annualPeriod: "/yr",
    annualNote: "~$82.50/mo",
    features: ["~1,200 listings / month", "Everything in Pro", "Multi-user access", "Priority support"],
    cta: "Open Shop",
    highlight: false,
  },
];

type BillingCycle = "monthly" | "annual";

export default function LandingPage() {
  const navigate = useNavigate();
  const { ref: statsRef, inView: statsInView } = useInView();
  const { ref: featuresRef, inView: featuresInView } = useInView(0.1);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  const listingsCount = useCounter(1200, 1800, statsInView);
  const timeSaved = useCounter(94, 1200, statsInView);
  const accuracy = useCounter(99, 1000, statsInView);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <img src={teckstartLogo} alt="Listing Assistant Pro" className="h-9 w-auto" />
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <button
              onClick={() => navigate("/login")}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign In
            </button>
            <button
              onClick={() => navigate("/signup")}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-95"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden px-5 pb-24 pt-32">
        {/* Ambient glow + grid */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-[-6rem] h-[520px] w-[820px] -translate-x-1/2 rounded-full blur-3xl"
            style={{ background: "radial-gradient(ellipse at center, hsl(var(--primary) / 0.18) 0%, transparent 68%)" }}
          />
          <div
            className="absolute inset-0 opacity-[0.5]"
            style={{
              backgroundImage:
                "linear-gradient(to right, hsl(var(--border) / 0.5) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.5) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              maskImage: "radial-gradient(ellipse at 50% 0%, black 20%, transparent 72%)",
              WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, black 20%, transparent 72%)",
            }}
          />
        </div>

        <div className="relative mx-auto max-w-3xl space-y-7 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            AI eBay Listing Assistant
          </div>

          {/* Headline */}
          <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight text-balance sm:text-6xl">
            From photo to published
            <span className="block text-primary">eBay listing in seconds</span>
          </h1>

          {/* Subheadline */}
          <p className="mx-auto max-w-xl text-base leading-relaxed text-muted-foreground text-pretty sm:text-lg">
            Upload photos of any resellable item. Get a complete, market-researched eBay listing — title, description, category, item specifics, and competitive pricing — ready to publish.
          </p>

          {/* CTAs */}
          <div className="flex flex-col items-center justify-center gap-3 pt-2 sm:flex-row">
            <button
              onClick={() => navigate("/signup")}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:opacity-90 active:scale-95 sm:w-auto"
            >
              Start Free — No Credit Card
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => navigate("/login")}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 py-3.5 text-sm font-medium text-foreground transition-all hover:bg-secondary active:scale-95 sm:w-auto"
            >
              Sign In
            </button>
          </div>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-1 pt-1">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="h-4 w-4 fill-primary text-primary" />
            ))}
            <span className="ml-2 text-xs text-muted-foreground">Trusted by resellers, dealers &amp; collectors</span>
          </div>
        </div>

        {/* Hero mockup card */}
        <div className="relative mx-auto mt-14 max-w-md">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10">
            {/* Fake browser bar */}
            <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-3">
              <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
              <div className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <div className="h-2.5 w-2.5 rounded-full bg-success/70" />
              <span className="ml-2 font-mono text-xs text-muted-foreground">listingassistant.pro</span>
            </div>
            {/* Mock listing result */}
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Analysis Complete</p>
                  <p className="text-xs text-muted-foreground">1921-D Morgan Dollar · MS-63</p>
                </div>
                <span className="ml-auto text-xs font-bold text-success">✓ Ready</span>
              </div>
              <div className="space-y-1 rounded-lg border-l-2 border-primary bg-secondary/60 p-3">
                <p className="text-xs font-semibold leading-snug text-foreground">
                  1921-D Morgan Silver Dollar MS-63 Lustrous Mint State — US Coin
                </p>
                <p className="text-xs text-muted-foreground">eBay Category: US Coins › Dollars › Morgan (1878–1921)</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[["Low", "$42.00"], ["Avg", "$58.50"], ["High", "$74.00"]].map(([label, val]) => (
                  <div key={label} className="rounded-lg bg-secondary/60 p-2 text-center">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-bold text-foreground">{val}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/10 px-3 py-2">
                <Shield className="h-3.5 w-3.5 flex-shrink-0 text-success" />
                <p className="text-xs font-medium text-success">Melt value: $27.84 · Price protected ✓</p>
              </div>
              <button className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-xs font-semibold text-primary-foreground">
                <Upload className="h-3.5 w-3.5" /> Publish to eBay
              </button>
            </div>
          </div>
          {/* Floating badge */}
          <div className="absolute -right-3 -top-3 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground shadow-lg">
            ⚡ 8 seconds
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section ref={statsRef} className="border-y border-border bg-secondary/30 px-5 py-14">
        <div className="mx-auto grid max-w-3xl grid-cols-3 gap-6 text-center">
          <div className="space-y-1">
            <p className="font-display text-3xl font-bold text-primary sm:text-4xl">
              {listingsCount.toLocaleString()}+
            </p>
            <p className="text-xs text-muted-foreground sm:text-sm">Listings Generated</p>
          </div>
          <div className="space-y-1">
            <p className="font-display text-3xl font-bold text-primary sm:text-4xl">{timeSaved}%</p>
            <p className="text-xs text-muted-foreground sm:text-sm">Time Saved vs. Manual</p>
          </div>
          <div className="space-y-1">
            <p className="font-display text-3xl font-bold text-primary sm:text-4xl">{accuracy}%</p>
            <p className="text-xs text-muted-foreground sm:text-sm">Category Accuracy</p>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section ref={featuresRef} className="px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 space-y-3 text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Built for serious resellers
            </h2>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground sm:text-base">
              Every feature is designed around one goal: getting accurate, competitive listings live faster than doing it by hand.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`group space-y-3 rounded-xl border border-border bg-card p-6 transition-all duration-500 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 ${
                  featuresInView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
                }`}
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="border-y border-border bg-secondary/30 px-5 py-24">
        <div className="mx-auto max-w-3xl">
          <div className="mb-12 space-y-3 text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
            <p className="text-sm text-muted-foreground">Three steps from item in hand to listing on eBay.</p>
          </div>
          <div className="space-y-4">
            {STEPS.map((step) => (
              <div key={step.num} className="flex items-start gap-5 rounded-xl border border-border bg-card p-5">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                  <span className="font-display text-sm font-bold text-primary">{step.num}</span>
                </div>
                <div className="flex-1 pt-1">
                  <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 space-y-3 text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Simple, transparent pricing</h2>
            <p className="text-sm text-muted-foreground">Start free. Upgrade when your volume grows.</p>
          </div>

          {/* Billing cycle toggle */}
          <div className="mb-10 flex items-center justify-center">
            <div className="flex items-center rounded-full border border-border bg-card p-1">
              <button
                onClick={() => setBillingCycle("monthly")}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition-all ${
                  billingCycle === "monthly"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle("annual")}
                className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-all ${
                  billingCycle === "annual"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Annual
                <span className="rounded-full bg-success px-2 py-0.5 text-xs font-bold text-success-foreground">
                  2 months free
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((plan) => {
              const displayPrice = billingCycle === "annual" ? plan.annualPrice : plan.price;
              const displayPeriod = billingCycle === "annual" ? plan.annualPeriod : plan.period;
              return (
                <div
                  key={plan.name}
                  className={`relative flex flex-col space-y-5 rounded-2xl border p-6 ${
                    plan.highlight
                      ? "border-primary bg-primary/5 shadow-xl shadow-primary/10 ring-1 ring-primary/30"
                      : "border-border bg-card"
                  }`}
                >
                  {plan.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[10px] font-bold text-primary-foreground">
                      {plan.badge}
                    </div>
                  )}
                  <div>
                    <h3 className="font-display text-lg font-bold text-foreground">{plan.name}</h3>
                    <div className="mt-1 flex items-baseline gap-0.5">
                      <span className="font-display text-3xl font-bold text-foreground">{displayPrice}</span>
                      <span className="text-sm text-muted-foreground">{displayPeriod}</span>
                    </div>
                    {billingCycle === "annual" && plan.annualNote && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{plan.annualNote}</p>
                    )}
                  </div>
                  <ul className="flex-1 space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => navigate("/signup")}
                    className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-all active:scale-95 ${
                      plan.highlight
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:opacity-90"
                        : "border border-border bg-transparent text-foreground hover:bg-secondary"
                    }`}
                  >
                    {plan.cta}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="relative overflow-hidden border-t border-border px-5 py-20">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 120%, hsl(var(--primary) / 0.16) 0%, transparent 60%)" }}
        />
        <div className="relative mx-auto max-w-xl space-y-5 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to list smarter?
          </h2>
          <p className="text-sm text-muted-foreground">
            Join resellers and dealers who are turning items into live eBay listings in under a minute.
          </p>
          <button
            onClick={() => navigate("/signup")}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:opacity-90 active:scale-95"
          >
            Get Started Free
            <ChevronRight className="h-4 w-4" />
          </button>
          <p className="text-xs text-muted-foreground">No credit card required · Cancel anytime</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-border px-5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <img src={teckstartLogo} alt="Listing Assistant Pro" className="h-8 w-auto opacity-70" />
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <button onClick={() => navigate("/terms")} className="transition-colors hover:text-foreground">Terms</button>
            <button onClick={() => navigate("/privacy")} className="transition-colors hover:text-foreground">Privacy</button>
            <button onClick={() => navigate("/login")} className="transition-colors hover:text-foreground">Sign In</button>
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Twin Wicks Digital Solutions. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}
