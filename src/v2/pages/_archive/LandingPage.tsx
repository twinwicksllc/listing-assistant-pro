import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  Camera, Sparkles, TrendingUp, Shield, Zap, ChevronRight,
  Star, Check, ArrowRight, BarChart3, Upload, Tag, Search, FileText
} from "lucide-react";
import teckstartLogo from "@/assets/teckstart-logo.png";

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
    color: "from-[#0076B6]/20 to-[#0076B6]/5",
    iconColor: "text-[#0076B6]",
  },
  {
    icon: FileText,
    title: "Complete Listing Generation",
    desc: "Receive a fully-formed eBay listing: an 80-character SEO title, detailed description, item specifics, and the correct leaf category — ready to review and publish.",
    color: "from-[#0076B6]/15 to-slate-500/5",
    iconColor: "text-[#0076B6]",
  },
  {
    icon: Search,
    title: "Live Competitor Pricing",
    desc: "Real-time eBay sold listing data surfaces current market comps so you set a price grounded in what buyers are actually paying — not instinct.",
    color: "from-[#B0B7BC]/30 to-[#B0B7BC]/10",
    iconColor: "text-slate-500",
  },
  {
    icon: Shield,
    title: "Melt Value Protection",
    desc: "Live gold, silver, and platinum spot prices are checked automatically. Precious metal items are never listed below their intrinsic melt value.",
    color: "from-emerald-500/15 to-emerald-600/5",
    iconColor: "text-emerald-600",
  },
  {
    icon: TrendingUp,
    title: "Agentic Market Grounding",
    desc: "Before generating your listing, the system searches the current market in real time — verifying category, pricing trends, and item-specific value factors like mint marks, grades, and variants.",
    color: "from-[#0076B6]/20 to-[#0076B6]/5",
    iconColor: "text-[#0076B6]",
  },
  {
    icon: Zap,
    title: "One-Tap eBay Publishing",
    desc: "Push directly to eBay as a draft listing. Review in the eBay app or desktop before going live — no copy-pasting, no reformatting.",
    color: "from-[#B0B7BC]/30 to-[#B0B7BC]/10",
    iconColor: "text-slate-500",
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
    period: "",
    features: ["6 listings / month", "Photo identification", "Draft saving"],
    cta: "Get Started Free",
    highlight: false,
  },
  {
    name: "Starter",
    price: "$19",
    period: "/mo",
    features: ["25 listings / month", "Full listing generation", "eBay publishing", "Draft saving"],
    cta: "Start Listing",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$49",
    period: "/mo",
    features: ["200 listings / month", "Full AI enhancement", "Voice notes", "Melt value protection", "Competitor pricing"],
    cta: "Go Pro",
    highlight: true,
    badge: "Most Popular",
  },
  {
    name: "Shop",
    price: "$99",
    period: "/mo",
    features: ["~1,200 listings / month", "Everything in Pro", "Multi-user access", "Priority support"],
    cta: "Open Shop",
    highlight: false,
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { ref: statsRef, inView: statsInView } = useInView();
  const { ref: featuresRef, inView: featuresInView } = useInView(0.1);

  const listingsCount = useCounter(1200, 1800, statsInView);
  const timeSaved = useCounter(94, 1200, statsInView);
  const accuracy = useCounter(99, 1000, statsInView);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-md border-b border-border/50"
           style={{ boxShadow: "0 1px 0 0 rgba(0,0,0,0.06)" }}>
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/login")}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => navigate("/signup")}
              className="text-sm font-semibold px-4 py-2 rounded-lg text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#0076B6" }}
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-28 pb-20 px-5 overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full blur-3xl"
               style={{ background: "radial-gradient(ellipse, rgba(0,118,182,0.10) 0%, transparent 70%)" }} />
          <div className="absolute top-24 right-0 w-[300px] h-[300px] rounded-full blur-3xl"
               style={{ background: "radial-gradient(ellipse, rgba(176,183,188,0.12) 0%, transparent 70%)" }} />
        </div>

        <div className="relative max-w-2xl mx-auto text-center space-y-6">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold"
               style={{ backgroundColor: "rgba(0,118,182,0.08)", borderColor: "rgba(0,118,182,0.2)", color: "#0076B6" }}>
            <Sparkles className="w-3.5 h-3.5" />
            eBay Listing Assistant — Powered by AI
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl font-extrabold text-foreground leading-tight tracking-tight">
            From Photo to Published
            <span className="block" style={{ color: "#0076B6" }}>
              eBay Listing in Seconds
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
            Upload photos of any resellable item. Get a complete, market-researched eBay listing — title, description, category, item specifics, and competitive pricing — ready to publish.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={() => navigate("/signup")}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all active:scale-95"
              style={{
                backgroundColor: "#0076B6",
                boxShadow: "0 4px 20px rgba(0,118,182,0.30), 0 2px 6px rgba(0,0,0,0.15)"
              }}
            >
              Start Free — No Credit Card
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate("/login")}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-border bg-card text-foreground font-medium text-sm hover:bg-secondary transition-all active:scale-95"
            >
              Sign In
            </button>
          </div>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-1 pt-1">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
            ))}
            <span className="text-xs text-muted-foreground ml-2">Trusted by resellers, dealers & collectors</span>
          </div>
        </div>

        {/* Hero mockup card */}
        <div className="relative max-w-sm mx-auto mt-12">
          <div className="bg-card border border-border rounded-2xl overflow-hidden"
               style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,118,182,0.10)" }}>
            {/* Fake browser bar */}
            <div className="border-b border-border px-4 py-3 flex items-center gap-2"
                 style={{ backgroundColor: "rgba(0,118,182,0.04)" }}>
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs text-muted-foreground ml-2 font-mono">lister.teckstart.com</span>
            </div>
            {/* Mock listing result */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                     style={{ backgroundColor: "rgba(0,118,182,0.10)" }}>
                  <Sparkles className="w-4 h-4" style={{ color: "#0076B6" }} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Analysis Complete</p>
                  <p className="text-xs text-muted-foreground">1921-D Morgan Dollar · MS-63</p>
                </div>
                <span className="ml-auto text-xs font-bold text-emerald-600">✓ Ready</span>
              </div>
              <div className="bg-secondary rounded-lg p-3 space-y-1"
                   style={{ borderLeft: "3px solid #0076B6" }}>
                <p className="text-xs font-semibold text-foreground leading-snug">
                  1921-D Morgan Silver Dollar MS-63 Lustrous Mint State — US Coin
                </p>
                <p className="text-xs text-muted-foreground">eBay Category: US Coins › Dollars › Morgan (1878–1921)</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[["Low", "$42.00"], ["Avg", "$58.50"], ["High", "$74.00"]].map(([label, val]) => (
                  <div key={label} className="bg-secondary rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-bold text-foreground">{val}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg px-3 py-2 flex items-center gap-2"
                   style={{ backgroundColor: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                <Shield className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <p className="text-xs text-emerald-700 font-medium">Melt value: $27.84 · Price protected ✓</p>
              </div>
              <button
                className="w-full py-2.5 rounded-lg text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                style={{ backgroundColor: "#0076B6" }}
              >
                <Upload className="w-3.5 h-3.5" /> Publish to eBay
              </button>
            </div>
          </div>
          {/* Floating badge */}
          <div className="absolute -top-3 -right-3 text-white text-xs font-bold px-2.5 py-1 rounded-full"
               style={{ backgroundColor: "#0076B6", boxShadow: "0 2px 8px rgba(0,0,0,0.20)" }}>
            ⚡ 8 seconds
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section ref={statsRef} className="py-14 px-5 border-y border-border"
               style={{ backgroundColor: "rgba(0,118,182,0.03)" }}>
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-6 text-center">
          <div className="space-y-1">
            <p className="text-3xl sm:text-4xl font-extrabold" style={{ color: "#0076B6" }}>
              {listingsCount.toLocaleString()}+
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground">Listings Generated</p>
          </div>
          <div className="space-y-1">
            <p className="text-3xl sm:text-4xl font-extrabold" style={{ color: "#0076B6" }}>{timeSaved}%</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Time Saved vs. Manual</p>
          </div>
          <div className="space-y-1">
            <p className="text-3xl sm:text-4xl font-extrabold" style={{ color: "#0076B6" }}>{accuracy}%</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Category Accuracy</p>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section ref={featuresRef} className="py-20 px-5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center space-y-3 mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground">
              Built for serious resellers
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
              Every feature is designed around one goal: getting accurate, competitive listings live faster than doing it by hand.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`rounded-xl border border-border p-5 space-y-3 transition-all duration-500 ${
                  featuresInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
                }`}
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center`}>
                  <f.icon className={`w-5 h-5 ${f.iconColor}`} />
                </div>
                <h3 className="font-semibold text-sm text-foreground">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-20 px-5 border-y border-border"
               style={{ backgroundColor: "rgba(0,0,0,0.02)" }}>
        <div className="max-w-3xl mx-auto">
          <div className="text-center space-y-3 mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground">How it works</h2>
            <p className="text-sm text-muted-foreground">Three steps from item in hand to listing on eBay.</p>
          </div>
          <div className="space-y-6">
            {STEPS.map((step, i) => (
              <div key={step.num} className="flex items-start gap-5">
                <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                     style={{
                       backgroundColor: "rgba(0,118,182,0.08)",
                       border: "1px solid rgba(0,118,182,0.20)"
                     }}>
                  <span className="text-xs font-extrabold" style={{ color: "#0076B6" }}>{step.num}</span>
                </div>
                <div className="flex-1 pt-1">
                  <h3 className="font-semibold text-foreground text-sm">{step.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.desc}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="absolute left-[2.35rem] mt-14 w-px h-6 bg-border" style={{ position: "relative", marginLeft: "-3.85rem", marginTop: "3.5rem" }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="py-20 px-5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center space-y-3 mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground">Simple, transparent pricing</h2>
            <p className="text-sm text-muted-foreground">Start free. Upgrade when your volume grows.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className="relative rounded-xl border p-5 space-y-5 flex flex-col"
                style={plan.highlight ? {
                  borderColor: "#0076B6",
                  boxShadow: "0 0 0 2px rgba(0,118,182,0.15)",
                  backgroundColor: "rgba(0,118,182,0.03)"
                } : {
                  borderColor: "hsl(var(--border))",
                  backgroundColor: "hsl(var(--card))"
                }}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-white text-[10px] font-bold px-3 py-1 rounded-full"
                       style={{ backgroundColor: "#0076B6" }}>
                    {plan.badge}
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-foreground">{plan.name}</h3>
                  <div className="flex items-baseline gap-0.5 mt-1">
                    <span className="text-2xl font-extrabold text-foreground">{plan.price}</span>
                    <span className="text-sm text-muted-foreground">{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "#0076B6" }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => navigate("/signup")}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all active:scale-95"
                  style={plan.highlight ? {
                    backgroundColor: "#0076B6",
                    color: "#fff",
                    boxShadow: "0 4px 14px rgba(0,118,182,0.25)"
                  } : {
                    border: "1px solid hsl(var(--border))",
                    backgroundColor: "transparent",
                    color: "hsl(var(--foreground))"
                  }}
                  onMouseEnter={e => { if (!plan.highlight) (e.target as HTMLButtonElement).style.backgroundColor = "hsl(var(--secondary))"; }}
                  onMouseLeave={e => { if (!plan.highlight) (e.target as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="py-16 px-5 border-t border-border"
               style={{ background: "linear-gradient(135deg, rgba(0,118,182,0.07) 0%, rgba(176,183,188,0.08) 50%, rgba(0,0,0,0.02) 100%)" }}>
        <div className="max-w-xl mx-auto text-center space-y-5">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground">
            Ready to list smarter?
          </h2>
          <p className="text-sm text-muted-foreground">
            Join resellers and dealers who are turning items into live eBay listings in under a minute.
          </p>
          <button
            onClick={() => navigate("/signup")}
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-all active:scale-95"
            style={{
              backgroundColor: "#0076B6",
              boxShadow: "0 4px 20px rgba(0,118,182,0.30), 0 2px 6px rgba(0,0,0,0.12)"
            }}
          >
            Get Started Free
            <ChevronRight className="w-4 h-4" />
          </button>
          <p className="text-xs text-muted-foreground">No credit card required · Cancel anytime</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-8 px-5 border-t border-border">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto opacity-70" />
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <button onClick={() => navigate("/terms")} className="hover:text-foreground transition-colors">Terms</button>
            <button onClick={() => navigate("/privacy")} className="hover:text-foreground transition-colors">Privacy</button>
            <button onClick={() => navigate("/login")} className="hover:text-foreground transition-colors">Sign In</button>
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Teckstart. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}