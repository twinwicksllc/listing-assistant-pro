/**
 * controller.ts
 * Main orchestrator for the modular agent system.
 * Implements: Sequential ID -> Parallel Burst (Visual + Market)
 */

import { AgentContext, Identification, MarketDataReport, VisualInspectionResult } from "./pipelineContracts.ts";
import { DOMAIN_REGISTRY } from "./registry.ts";
import { resolveDomainPromotion } from "./domainSignals.ts";
import { runPass1Identification } from "../pass1Identification.ts";
import { runAgenticVisualAgent } from "./sub-agents/visual-agent.ts";
import { runMarketAgent } from "./sub-agents/market-agent.ts";
import { getEmbedding } from "../rag/embedding.ts";
import { PIPELINE_TIMEOUTS_MS, withDeadline } from "../fetchWithTimeout.ts";
import { StageTimer } from "../stageTimer.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

export class ListingAgentController {
  private apiKey: string;
  private supabase: ReturnType<typeof createClient<any>>;
  /**
   * Wall-clock instrumentation. The caller (analyze-item) passes its own timer
   * so the controller's stages land in the SAME one-line summary as the rest of
   * the pipeline; when nothing is passed we keep a private timer so the stages
   * are still recorded (and reachable via `timings()`) rather than silently
   * dropped. Purely observational -- see stageTimer.ts.
   */
  private timer: StageTimer;

  constructor(
    apiKey: string,
    supabase: ReturnType<typeof createClient<any>>,
    timer?: StageTimer,
  ) {
    this.apiKey = apiKey;
    this.supabase = supabase;
    this.timer = timer ?? new StageTimer("agent-controller");
  }

  /** The timer holding this controller's stage timings (for merging/reporting). */
  timings(): StageTimer {
    return this.timer;
  }

  async run(context: AgentContext): Promise<{
    identification: Identification;
    visualFindings: VisualInspectionResult | null;
    marketReport: MarketDataReport | null;
  }> {
    const { invocationId, imageList, voiceNote, deadline } = context;

    // --- STEP 1: Sequential Identification (Runner) ---
    console.log(
      `[${invocationId}] Controller: Starting Stage 1 (Identification)`,
    );
    const identificationRaw = await this.timer.time(
      "pass1_identification",
      () =>
        runPass1Identification(
          this.apiKey,
          imageList,
          voiceNote || "",
          invocationId,
          deadline,
        ),
    );

    // Cast and normalize the identification
    const identification: Identification = {
      domain: (identificationRaw.domain as any) || "general",
      itemName: identificationRaw.itemName || "item",
      keywords: identificationRaw.keywords || [],
      isMetal: identificationRaw.isMetal || false,
      metalType: identificationRaw.metalType || "none",
    };

    console.log(
      `[${invocationId}] Controller: Stage 1 Complete. Domain=${identification.domain}`,
    );

    // Pre-compute item embedding once — shared by Visual and Market sub-agents
    // to avoid duplicate embedding API calls (would otherwise be identical for both).
    let queryEmbedding: number[] | undefined;
    try {
      queryEmbedding = await this.timer.time(
        "rag_embedding",
        () =>
          getEmbedding(
            this.apiKey,
            identification.itemName,
            withDeadline(PIPELINE_TIMEOUTS_MS.embedding, deadline),
          ),
      );
      console.log(
        `[${invocationId}] Controller: Embedding pre-computed for "${identification.itemName}"`,
      );
    } catch (embErr) {
      console.warn(
        `[${invocationId}] Controller: Embedding pre-computation failed (non-blocking):`,
        embErr,
      );
    }

    // Update context with identification and shared embedding for sub-agents
    const enrichedContext = { ...context, identification, queryEmbedding };

    // --- STEP 2: Parallel Burst (Visual + Market) ---
    console.log(
      `[${invocationId}] Controller: Starting Stage 2 (Parallel Burst)`,
    );

    // We launch these concurrently to minimize latency.
    // `parallel_burst` brackets the whole window; `visual_agent` and
    // `market_agent` are timed individually inside it so the summary shows which
    // one dominates (the visual agent is the accuracy-critical 110s-budget
    // stage; overlap between the two is reported, not summed).
    const burstEnd = this.timer.start("parallel_burst");
    const [visualFindings, marketReport] = await Promise.allSettled([
      this.runVisualAgent(enrichedContext),
      this.runMarketAgent(enrichedContext),
    ]);
    burstEnd();

    const visualResult = visualFindings.status === "fulfilled" ? visualFindings.value : null;
    const marketResult = marketReport.status === "fulfilled" ? marketReport.value : null;

    // Close the feedback loop: apply the Visual Agent's identificationCorrection back to
    // identification so that Slab OCR eligibility, domain fallback, and isCoinCategoryFlag
    // all benefit from precision vision findings — not just the Pass 2 prompt.
    // Guard: only act when confidenceBoost >= 70 to prevent low-confidence noise.
    const correction = visualResult?.identificationCorrection;
    const boost = visualResult?.confidenceBoost ?? 0;
    if (correction && boost >= 70) {
      const { promotedDomain } = resolveDomainPromotion(correction, identification.domain);
      if (promotedDomain) {
        console.log(
          `[${invocationId}] Controller: identificationCorrection → upgrading domain from "${identification.domain}" to "${promotedDomain}" (boost=${boost})`,
        );
        identification.domain = promotedDomain;
      }
      // Attempt to extract a more precise item name from the correction text
      const nameMatch = correction.match(
        /(?:is|appears to be|actually a?n?)\s+([^.,"]{5,60})/i,
      );
      if (nameMatch?.[1]) {
        const correctedName = nameMatch[1].trim();
        if (
          correctedName.toLowerCase() !== identification.itemName.toLowerCase()
        ) {
          console.log(
            `[${invocationId}] Controller: identificationCorrection → itemName "${identification.itemName}" → "${correctedName}"`,
          );
          identification.itemName = correctedName;
        }
      }
    }

    return {
      identification,
      visualFindings: visualResult,
      marketReport: marketResult,
    };
  }

  private async runVisualAgent(
    context: AgentContext,
  ): Promise<VisualInspectionResult> {
    const domainDef = DOMAIN_REGISTRY[context.identification!.domain];
    // time() rethrows unchanged, so a visual-agent failure still arrives at the
    // Promise.allSettled above exactly as before -- only now it has a duration.
    return await this.timer.time(
      "visual_agent",
      () =>
        runAgenticVisualAgent(
          this.apiKey,
          domainDef,
          context,
          this.supabase,
        ),
    );
  }

  private async runMarketAgent(
    context: AgentContext,
  ): Promise<MarketDataReport> {
    const domainDef = DOMAIN_REGISTRY[context.identification!.domain];
    return await this.timer.time(
      "market_agent",
      () => runMarketAgent(this.apiKey, domainDef, context, this.supabase),
    );
  }
}
