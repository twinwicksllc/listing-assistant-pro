import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  Camera, Sparkles, TrendingUp, Shield, Zap, ChevronRight,
  Star, Check, ArrowRight, Coins, BarChart3, Upload
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
    title: "Snap & Analyze",
    desc: "Photograph your item from multiple angles. Our AI identifies it instantly — coins, bullion, collectibles, and more.",
    color: "from-blue-500/20 to-blue-600/10",
    iconColor: "text-blue-500",
  },
  {
    icon: Sparkles,
    title: "AI-Generated Listings",
    desc: "Get a professional eBay title (80 chars, SEO-optimized), detailed description, item specifics, and the right category — automatically.",
    color: "from-purple-500/20 to-purple-600/10",
    iconColor: "text-purple-500",
  },
  {
    icon: Coins,
    title: "Expert Coin Grading",
    desc: "Unslabbed coins get a full Sheldon-scale grade assessment — wear analysis, luster, strike quality, and a detailed rationale.",
    color: "from-amber-500/20 to-amber-600/10",
    iconColor: "text-amber-500",
  },
  {
    icon: Shield,
    title: "Melt Value Protection",
    desc: "Live gold, silver, and platinum spot prices ensure your listings are never priced below intrinsic metal value.",
    color: "from-green-500/20 to-green-600/10",
    iconColor: "text-green-500",
  },
  {
    icon: TrendingUp,
    title: "Real-Time Pricing",
    desc: "eBay sold listing comps pulled live so you price competitively every time — not based on guesswork.",
    color: "from-rose-500/20 to-rose-600/10",
    iconColor: "text-rose-500",
  },
  {
    icon: Zap,
    title: "One-Tap Publish",
    desc: "Push directly to eBay as a draft listing with your EPN affiliate link ready to share and earn commissions.",
    color: "from-cyan-500/20 to-cyan-600/10",
    iconColor: "text-cyan-500",
  },
];

const STEPS = [
  { num: "01", title: "Capture", desc: "Take photos or upload images of your item. Add a voice note for extra context." },
  { num: "02", title: "Analyze", desc: "AI identifies the item, grades it, writes the listing, and researches pricing in seconds." },
  { num: "03", title: "Publish", desc: "Review, edit if needed, then push directly to eBay with one tap." },
];

const PLANS = [
  {
    name: "Starter",
    price: "Free",
    period: "",
    features: ["5 AI analyses / month", "3 eBay publishes / month", "Basic item recognition", "Draft saving"],
    cta: "Get Started Free",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$19.99",
    period: "/mo",
    features: ["50 AI analyses / month", "25 eBay publishes / month", "Coin grading + rationale", "Live spot price protection", "eBay sold comps"],
    cta: "Start Pro",
    highlight: true,
    badge: "Most Popular",
  },
  {
    name: "Unlimited",
    price: "$49.99",
    period: "/mo",
    features: ["Unlimited AI analyses", "Unlimited eBay publishes", "Everything in Pro", "Team / multi-lister support", "Priority support"],
    cta: "Go Unlimited",
    highlight: false,
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { ref: statsRef, inView: statsInView } = useInView();
  const { ref: featuresRef, inView: featuresInView } = useInView(0.1);

  const listingsCount = useCounter(12400, 1800, statsInView);
  const timeSaved = useCounter(94, 1200, statsInView);
  const accuracy = useCounter(99, 1000, statsInView);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <img src={teckstartLogo} alt="Teckstart" className="h-8 w-auto" />
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/login")}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => navigate("/signup")}
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
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
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute top-20 right-0 w-[300px] h-[300px] bg-purple-500/8 rounded-full blur-3xl" />
          <div className="absolute top-40 left-0 w-[250px] h-[250px] bg-amber-500/8 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-2xl mx-auto text-center space-y-6">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            AI-Powered eBay Listing Assistant
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl font-extrabold text-foreground leading-tight tracking-tight">
            List Coins & Collectibles
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-500">
              10× Faster with AI
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
            Snap a photo. Get a professional eBay listing with AI coin grading, live spot price protection, and real-time sold comps — in seconds.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={() => navigate("/signup")}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-all shadow-lg shadow-primary/25 active:scale-95"
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
            <span className="text-xs text-muted-foreground ml-2">Trusted by coin dealers & collectors</span>
          </div>
        </div>

        {/* Hero mockup card */}
        <div className="relative max-w-sm mx-auto mt-12">
          <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            {/* Fake phone header */}
            <div className="bg-primary/5 border-b border-border px-4 py-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs text-muted-foreground ml-2 font-mono">lister.teckstart.com</span>
            </div>
            {/* Mock listing result */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">AI Analysis Complete</p>
                  <p className="text-xs text-muted-foreground">1921-D Morgan Dollar • MS-63</p>
                </div>
                <span className="ml-auto text-xs font-bold text-green-500">✓ Done</span>
              </div>
              <div className="bg-secondary rounded-lg p-3 space-y-1">
                <p className="text-xs font-semibold text-foreground leading-snug">
                  1921-D Morgan Silver Dollar MS-63 PCGS Lustrous Mint State Coin
                </p>
                <p className="text-xs text-muted-foreground">eBay Category: US Coins › Dollars › Morgan</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[["Low", "$42.00"], ["Avg", "$58.50"], ["High", "$74.00"]].map(([label, val]) => (
                  <div key={label} className="bg-secondary rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-bold text-foreground">{val}</p>
                  </div>
                ))}
              </div>
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                <p className="text-xs text-green-600 font-medium">Melt value: $27.84 · Price protected ✓</p>
              </div>
              <button className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1.5">
                <Upload className="w-3.5 h-3.5" /> Publish to eBay
              </button>
            </div>
          </div>
          {/* Floating badge */}
          <div className="absolute -top-3 -right-3 bg-amber-400 text-amber-900 text-xs font-bold px-2.5 py-1 rounded-full shadow-lg">
            ⚡ 8 seconds
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section ref={statsRef} className="py-14 px-5 border-y border-border bg-secondary/30">
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-6 text-center">
          <div className="space-y-1">
            <p className="text-3xl sm:text-4xl font-extrabold text-primary">
              {listingsCount.toLocaleString()}+
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground">Listings Generated</p>
          </div>
          <div className="space-y-1">
            <p className="text-3xl sm:text-4xl font-extrabold text-primary">{timeSaved}%</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Time Saved vs Manual</p>
          </div>
          <div className="space-y-1">
            <p className="text-3xl sm:text-4xl font-extrabold text-primary">{accuracy}%</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Category Accuracy</p>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section ref={featuresRef} className="py-20 px-5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center space-y-3 mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground">
              Everything you need to list smarter
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
              Built specifically for coins, bullion, and collectibles — not a generic listing tool.
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
      <section className="py-20 px-5 bg-secondary/20 border-y border-border">
        <div className="max-w-3xl mx-auto">
          <div className="text-center space-y-3 mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground">How it works</h2>
            <p className="text-sm text-muted-foreground">From photo to published listing in under a minute.</p>
          </div>
          <div className="space-y-6">
            {STEPS.map((step, i) => (
              <div key={step.num} className="flex items-start gap-5">
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <span className="text-xs font-extrabold text-primary">{step.num}</span>
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
            <p className="text-sm text-muted-foreground">Start free. Upgrade when you're ready to scale.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-xl border p-5 space-y-5 flex flex-col ${
                  plan.highlight
                    ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                    : "border-border bg-card"
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] font-bold px-3 py-1 rounded-full">
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
                      <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => navigate("/signup")}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all active:scale-95 ${
                    plan.highlight
                      ? "bg-primary text-primary-foreground hover:opacity-90 shadow-lg shadow-primary/25"
                      : "border border-border bg-background text-foreground hover:bg-secondary"
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="py-16 px-5 bg-gradient-to-br from-primary/10 via-purple-500/5 to-background border-t border-border">
        <div className="max-w-xl mx-auto text-center space-y-5">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground">
            Ready to list smarter?
          </h2>
          <p className="text-sm text-muted-foreground">
            Join coin dealers and collectors who are saving hours every week with AI-powered listings.
          </p>
          <button
            onClick={() => navigate("/signup")}
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-all shadow-lg shadow-primary/25 active:scale-95"
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
          <img src={teckstartLogo} alt="Teckstart" className="h-7 w-auto opacity-70" />
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