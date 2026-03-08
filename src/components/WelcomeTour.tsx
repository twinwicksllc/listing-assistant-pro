import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

export interface TourStep {
  /** CSS selector or data-tour attribute value */
  target: string;
  title: string;
  description: string;
  placement?: "top" | "bottom" | "left" | "right";
}

interface WelcomeTourProps {
  steps: TourStep[];
  active: boolean;
  onFinish: () => void;
}

export default function WelcomeTour({ steps, active, onFinish }: WelcomeTourProps) {
  const [current, setCurrent] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const measureTarget = useCallback(() => {
    if (!active || !steps[current]) return;
    const selector = steps[current].target;
    const el =
      document.querySelector(`[data-tour="${selector}"]`) ||
      document.querySelector(selector);
    if (el) {
      setRect(el.getBoundingClientRect());
    } else {
      setRect(null);
    }
  }, [active, current, steps]);

  useEffect(() => {
    measureTarget();
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);
    return () => {
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
    };
  }, [measureTarget]);

  useEffect(() => {
    if (active) setCurrent(0);
  }, [active]);

  if (!active || !steps.length) return null;

  const step = steps[current];
  const isLast = current === steps.length - 1;
  const placement = step.placement || "bottom";

  // Tooltip positioning
  let tooltipStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 10001,
    maxWidth: 300,
  };

  if (rect) {
    const gap = 12;
    switch (placement) {
      case "bottom":
        tooltipStyle.top = rect.bottom + gap;
        tooltipStyle.left = rect.left + rect.width / 2;
        tooltipStyle.transform = "translateX(-50%)";
        break;
      case "top":
        tooltipStyle.bottom = window.innerHeight - rect.top + gap;
        tooltipStyle.left = rect.left + rect.width / 2;
        tooltipStyle.transform = "translateX(-50%)";
        break;
      case "left":
        tooltipStyle.top = rect.top + rect.height / 2;
        tooltipStyle.right = window.innerWidth - rect.left + gap;
        tooltipStyle.transform = "translateY(-50%)";
        break;
      case "right":
        tooltipStyle.top = rect.top + rect.height / 2;
        tooltipStyle.left = rect.right + gap;
        tooltipStyle.transform = "translateY(-50%)";
        break;
    }
  } else {
    // Center fallback
    tooltipStyle.top = "50%";
    tooltipStyle.left = "50%";
    tooltipStyle.transform = "translate(-50%, -50%)";
  }

  // Clamp to viewport
  if (typeof tooltipStyle.left === "number") {
    tooltipStyle.left = Math.max(16, Math.min(tooltipStyle.left as number, window.innerWidth - 316));
  }

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[10000] transition-opacity duration-300"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={onFinish}
      />

      {/* Spotlight cutout */}
      {rect && (
        <div
          className="fixed z-[10000] rounded-xl pointer-events-none"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            background: "transparent",
          }}
        />
      )}

      {/* Tooltip */}
      <div
        style={tooltipStyle}
        className="bg-card border border-border rounded-xl shadow-xl p-4 animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-sm font-bold text-foreground">{step.title}</h3>
          <button
            onClick={onFinish}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">{step.description}</p>

        <div className="flex items-center justify-between">
          {/* Dots */}
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === current ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {current > 0 && (
              <button
                onClick={() => setCurrent((c) => c - 1)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <ChevronLeft className="w-3 h-3" />
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (isLast) onFinish();
                else setCurrent((c) => c + 1);
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              {isLast ? "Got it!" : "Next"}
              {!isLast && <ChevronRight className="w-3 h-3" />}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
