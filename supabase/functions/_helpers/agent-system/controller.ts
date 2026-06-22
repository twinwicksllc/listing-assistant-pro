/**
 * controller.ts
 * Main orchestrator for the modular agent system.
 * Implements: Sequential ID -> Parallel Burst (Visual + Market)
 */

import { AgentContext, Identification, MarketDataReport, VisualInspectionResult } from "./pipelineContracts.ts";
import { DOMAIN_REGISTRY } from "./registry.ts";
import { runPass1Identification } from "../pass1Identification.ts";
import { runAgenticVisualAgent } from "./sub-agents/visual-agent.ts";
import { runMarketAgent } from "./sub-agents/market-agent.ts";

export class ListingAgentController {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async run(context: AgentContext): Promise<{
    identification: Identification;
    visualFindings: VisualInspectionResult | null;
    marketReport: MarketDataReport | null;
  }> {
    const { invocationId, imageList, voiceNote } = context;

    // --- STEP 1: Sequential Identification (Runner) ---
    console.log(`[${invocationId}] Controller: Starting Stage 1 (Identification)`);
    const identificationRaw = await runPass1Identification(
      this.apiKey,
      imageList,
      voiceNote || "",
      invocationId,
    );

    // Cast and normalize the identification
    const identification: Identification = {
      domain: (identificationRaw.domain as any) || "general",
      itemName: identificationRaw.itemName || "item",
      keywords: identificationRaw.keywords || [],
      isMetal: identificationRaw.isMetal || false,
      metalType: identificationRaw.metalType || "none",
    };

    console.log(`[${invocationId}] Controller: Stage 1 Complete. Domain=${identification.domain}`);

    // Update context with identification for sub-agents
    const enrichedContext = { ...context, identification };

    // --- STEP 2: Parallel Burst (Visual + Market) ---
    console.log(`[${invocationId}] Controller: Starting Stage 2 (Parallel Burst)`);

    // We launch these concurrently to minimize latency
    const [visualFindings, marketReport] = await Promise.allSettled([
      this.runVisualAgent(enrichedContext),
      this.runMarketAgent(enrichedContext),
    ]);

    return {
      identification,
      visualFindings: visualFindings.status === "fulfilled" ? visualFindings.value : null,
      marketReport: marketReport.status === "fulfilled" ? marketReport.value : null,
    };
  }

  private async runVisualAgent(context: AgentContext): Promise<VisualInspectionResult> {
    const domainDef = DOMAIN_REGISTRY[context.identification!.domain];
    return await runAgenticVisualAgent(
      this.apiKey,
      domainDef,
      context,
    );
  }

  private async runMarketAgent(context: AgentContext): Promise<MarketDataReport> {
    const domainDef = DOMAIN_REGISTRY[context.identification!.domain];
    return await runMarketAgent(
      this.apiKey,
      domainDef,
      context,
    );
  }
}
