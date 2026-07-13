/**
 * registry.ts
 * Central registry for domain-specific AI logic, vision targets, and grounding requirements.
 */

import { Domain } from "./pipelineContracts.ts";

export interface ZoomTarget {
  region: string;
  rationale: string;
}

export interface DomainDefinition {
  domain: Domain;

  // Specific visual tasks for the Visual Agent
  visionGoals: ZoomTarget[];

  // Logic for generating grounding queries
  groundingQueries: (itemName: string) => string[];

  // Critical attributes to highlight in prompts
  criticalAttributes: string[];
}

/**
 * DOMAIN_RAG_CATEGORIES
 * Maps each domain to the `knowledge_base.category` value(s) that should be
 * retrieved (via match_knowledge_base) to ground the Visual Agent's inspection.
 *
 * This is the generalized successor to the old coins_bullion-only RAG gate in
 * visual-agent.ts. A domain with no entry here (or an empty array) simply
 * skips RAG injection - no hardcoded category IDs, no per-domain special
 * casing beyond this lookup table. Multiple categories may be listed; the
 * first one that returns results is used (see visual-agent.ts).
 *
 * NOTE: This only controls *which knowledge_base category to query*. It does
 * NOT gate whether a domain is otherwise supported - all 12 domains are fully
 * supported end-to-end regardless of RAG coverage.
 */
export const DOMAIN_RAG_CATEGORIES: Partial<Record<Domain, string[]>> = {
  coins_bullion: ["grading_standard"],
  sneakers: ["sneaker_authentication"],
  electronics: ["electronics_spec_standard"],
  jewelry: ["jewelry_hallmark_standard"],
  auto_parts: ["auto_parts_fitment"],
  luxury_handbags: ["handbag_authentication"],
};

export const DOMAIN_REGISTRY: Record<Domain, DomainDefinition> = {
  coins_bullion: {
    domain: "coins_bullion",
    visionGoals: [
      {
        region: "certification slab label (PCGS/NGC/ANACS/ICG/PMG/Legacy Currency Grading text)",
        rationale:
          "Extract authoritative year, denomination, grade, cert number, and any special designations (e.g. EPQ, DCAM, NET). Read each digit carefully — misreads of slab labels are a known AI failure mode.",
      },
      {
        region: "PMG or Legacy Currency Grading label (for paper money/banknotes)",
        rationale: "Extract grade, serial number, and EPQ/NET designation from currency slab labels if present.",
      },
      {
        region: "date and mint mark on coin face",
        rationale:
          "Confirm year and mint (e.g., 'D', 'S', 'P', 'CC') for raw coins. The current year is valid — do not classify recent-dated coins as novelty.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" 2026 coin numismatic`,
      `eBay recently sold "${itemName}" price mint mark error premium`,
    ],
    criticalAttributes: ["Year", "Mint Mark", "Grade", "Composition", "Certification"],
  },
  electronics: {
    domain: "electronics",
    visionGoals: [
      {
        region: "model number / serial sticker",
        rationale: "Identify exact model variants and verify authenticity.",
      },
      {
        region: "ports and connector pins",
        rationale: "Check for corrosion, bent pins, or signs of heavy use.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" electronics 2026`,
      `eBay recently sold "${itemName}" price with accessories`,
    ],
    criticalAttributes: ["Model Number", "Storage Capacity", "Connectivity", "Included Accessories"],
  },
  vintage_clothing: {
    domain: "vintage_clothing",
    visionGoals: [
      {
        region: "brand label and size tag",
        rationale: "Verify era (vintage vs modern) and confirm sizing.",
      },
      {
        region: "common wear points (collar, cuffs, underarms)",
        rationale: "Scan for stains, tears, or fraying.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" vintage clothing 2026`,
      `eBay recently sold "${itemName}" price condition nuances`,
    ],
    criticalAttributes: ["Brand", "Size", "Era", "Material", "Condition Notes"],
  },
  trading_cards: {
    domain: "trading_cards",
    visionGoals: [
      {
        region: "card number and set symbol",
        rationale: "Identify exact set and print variant.",
      },
      {
        region: "corners and edges",
        rationale: "Assess condition for whitening or soft corners.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" trading card 2026`,
      `eBay recently sold "${itemName}" card price variant`,
    ],
    criticalAttributes: ["Set Name", "Card Number", "Year", "Parallel/Variant", "Grade"],
  },
  jewelry: {
    domain: "jewelry",
    visionGoals: [
      {
        region: "hallmarks (e.g., 14K, 925, maker mark)",
        rationale: "Verify metal purity and authenticity.",
      },
      {
        region: "clasps and stones",
        rationale: "Check for security and wear.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" jewelry 2026`,
      `eBay recently sold "${itemName}" jewelry price karat`,
    ],
    criticalAttributes: ["Metal Purity", "Main Stone", "Weight", "Hallmarks"],
  },
  general: {
    domain: "general",
    visionGoals: [
      {
        region: "identifying labels or logos",
        rationale: "General identification of the item.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" 2026`,
      `eBay recently sold "${itemName}" price`,
    ],
    criticalAttributes: ["Brand", "Condition", "Primary Use"],
  },
  auto_parts: {
    domain: "auto_parts",
    visionGoals: [
      {
        region: "stamped part number or manufacturer logo",
        rationale: "Extract precise part number for fitment/compatibility data.",
      },
      {
        region: "connectors, threads, or mounting points",
        rationale: "Check for wear, damage, or mounting integrity.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" car parts 2026`,
      `eBay recently sold "${itemName}" part compatibility price`,
    ],
    criticalAttributes: ["Part Number", "Brand", "Fitment Type", "Placement on Vehicle"],
  },
  sneakers: {
    domain: "sneakers",
    visionGoals: [
      {
        region: "inner size tag and SKU label",
        rationale: "Verify SKU (e.g., 'CT8013-170') and manufacture date.",
      },
      {
        region: "sole wear and stitching patterns",
        rationale: "Assess condition and provide authenticity indicators.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" sneakers 2026`,
      `eBay recently sold "${itemName}" price stockx comparison`,
    ],
    criticalAttributes: ["SKU / Model Number", "Size", "Colorway", "Original Packaging"],
  },
  luxury_handbags: {
    domain: "luxury_handbags",
    visionGoals: [
      {
        region: "date code stamp or authenticity card",
        rationale: "Identify manufacturing year and factory code.",
      },
      {
        region: "hardware (zippers, clasps) and stitching",
        rationale: "Inspect for authenticity and plating wear.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" luxury handbag 2026`,
      `eBay recently sold "${itemName}" price premium condition`,
    ],
    criticalAttributes: ["Brand", "Model Name", "Material", "Date Code", "Accessories"],
  },
  musical_instruments: {
    domain: "musical_instruments",
    visionGoals: [
      {
        region: "headstock (front and back) or soundhole label",
        rationale: "Extract serial number and brand logos.",
      },
      {
        region: "fingreboard, frets, or electronics cavity",
        rationale: "Assess wear levels and component authenticity.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" musical instrument 2026`,
      `eBay recently sold "${itemName}" price serial year`,
    ],
    criticalAttributes: ["Brand", "Model Number", "Year of Manufacture", "Serial Number"],
  },
  toys_collectibles: {
    domain: "toys_collectibles",
    visionGoals: [
      {
        region: "packaging seals and corners (if boxed)",
        rationale: "Assess value impact of packaging condition.",
      },
      {
        region: "manufacturer marks or copyright dates",
        rationale: "Identify specific production runs or variations.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" collectible 2026`,
      `eBay recently sold "${itemName}" price variant edition`,
    ],
    criticalAttributes: ["Brand / Set", "Character / Series", "Year / Era", "Variant"],
  },
  home_garden_tools: {
    domain: "home_garden_tools",
    visionGoals: [
      {
        region: "spec plate / power rating label",
        rationale: "Confirm voltage, wattage, and exact model code.",
      },
      {
        region: "tool head or cutting surface",
        rationale: "Evaluate remaining life and maintenance state.",
      },
    ],
    groundingQueries: (itemName: string) => [
      `eBay leaf category ID "${itemName}" tools 2026`,
      `eBay recently sold "${itemName}" price cordless corded`,
    ],
    criticalAttributes: ["Brand", "Model Number", "Power Source", "Included Batteries"],
  },
};
