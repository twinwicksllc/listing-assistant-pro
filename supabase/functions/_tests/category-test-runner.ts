/**
 * Category Lookup Test Runner
 *
 * Runs the 60-case test fixture against the category-lookup function
 * and produces a metrics report.
 *
 * Usage (local):
 *   deno run --allow-read --allow-net --allow-env category-test-runner.ts
 *
 * Requires env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import process from "node:process";
import fixtures from "./category-test-fixtures.json" with { type: "json" };

interface TestResult {
  id: string;
  group: string;
  input: string;
  expectedCategoryId: string;
  expectedBreadcrumb: string;
  actualCategoryId: string | null;
  actualBreadcrumb: string | null;
  candidateSource: string | null;
  candidateScore: number | null;
  reasonSelected: string | null;
  verifiedLeaf: boolean | null;
  verifiedActive: boolean | null;
  persistedToDb: boolean | null;
  match: boolean;
  latencyMs: number;
  error: string | null;
}

interface MetricsSummary {
  total: number;
  top1Accuracy: number;
  invalidNonLeafRate: number;
  byGroup: Record<string, { total: number; correct: number; accuracy: number }>;
  bySource: Record<string, number>;
  avgLatencyMs: number;
  failures: TestResult[];
}

async function runTest(
  testCase: (typeof fixtures.cases)[0],
  baseUrl: string,
  serviceKey: string,
): Promise<TestResult> {
  const start = Date.now();
  const result: TestResult = {
    id: testCase.id,
    group: testCase.group,
    input: testCase.input,
    expectedCategoryId: testCase.expectedCategoryId,
    expectedBreadcrumb: testCase.expectedBreadcrumb,
    actualCategoryId: null,
    actualBreadcrumb: null,
    candidateSource: null,
    candidateScore: null,
    reasonSelected: null,
    verifiedLeaf: null,
    verifiedActive: null,
    persistedToDb: null,
    match: false,
    latencyMs: 0,
    error: null,
  };

  try {
    const resp = await fetch(`${baseUrl}/functions/v1/category-lookup`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "lookup",
        itemType: testCase.input,
      }),
    });

    const data = await resp.json();

    result.actualCategoryId = data.categoryId || null;
    result.actualBreadcrumb = data.breadcrumb || null;
    result.candidateSource = data.source || data.candidateSource || null;
    result.candidateScore = data.confidence || data.candidateScore || null;
    result.reasonSelected = data.reasonSelected || null;
    result.verifiedLeaf = data.verifiedLeaf ?? null;
    result.verifiedActive = data.verifiedActive ?? null;
    result.persistedToDb = data.persistedToDb ?? null;
    result.match = result.actualCategoryId === testCase.expectedCategoryId;

    if (data.error) {
      result.error = data.error;
    }
  } catch (err: any) {
    result.error = err.message || String(err);
  }

  result.latencyMs = Date.now() - start;
  return result;
}

function computeMetrics(results: TestResult[]): MetricsSummary {
  const total = results.length;
  const correct = results.filter((r) => r.match).length;

  // By group
  const groups: Record<
    string,
    { total: number; correct: number; accuracy: number }
  > = {};
  for (const r of results) {
    if (!groups[r.group]) {
      groups[r.group] = { total: 0, correct: 0, accuracy: 0 };
    }
    groups[r.group].total++;
    if (r.match) groups[r.group].correct++;
  }
  for (const g of Object.values(groups)) {
    g.accuracy = g.total > 0 ? Math.round((g.correct / g.total) * 100) : 0;
  }

  // By source
  const sources: Record<string, number> = {};
  for (const r of results) {
    const src = r.candidateSource || "unknown";
    sources[src] = (sources[src] || 0) + 1;
  }

  // Non-leaf rate (where verifiedLeaf is explicitly false)
  const nonLeafCount = results.filter((r) => r.verifiedLeaf === false).length;

  // Average latency
  const avgLatency = Math.round(
    results.reduce((sum, r) => sum + r.latencyMs, 0) / total,
  );

  return {
    total,
    top1Accuracy: Math.round((correct / total) * 100),
    invalidNonLeafRate: Math.round((nonLeafCount / total) * 100),
    byGroup: groups,
    bySource: sources,
    avgLatencyMs: avgLatency,
    failures: results.filter((r) => !r.match),
  };
}

function printReport(metrics: MetricsSummary) {
  console.log("\n" + "=".repeat(70));
  console.log("  CATEGORY LOOKUP TEST REPORT");
  console.log("=".repeat(70));

  console.log(`\n  Total test cases:     ${metrics.total}`);
  console.log(`  Top-1 Accuracy:       ${metrics.top1Accuracy}%`);
  console.log(`  Invalid/Non-leaf:     ${metrics.invalidNonLeafRate}%`);
  console.log(`  Avg Latency:          ${metrics.avgLatencyMs}ms`);

  console.log("\n  BY GROUP:");
  for (const [group, data] of Object.entries(metrics.byGroup)) {
    console.log(
      `    ${group.padEnd(20)} ${data.correct}/${data.total} (${data.accuracy}%)`,
    );
  }

  console.log("\n  BY SOURCE:");
  for (const [source, count] of Object.entries(metrics.bySource)) {
    console.log(`    ${source.padEnd(20)} ${count}`);
  }

  if (metrics.failures.length > 0) {
    console.log(`\n  FAILURES (${metrics.failures.length}):`);
    for (const f of metrics.failures) {
      console.log(`    [${f.id}] "${f.input}"`);
      console.log(
        `      Expected: ${f.expectedCategoryId} | Got: ${f.actualCategoryId || "NONE"} (${
          f.candidateSource || "?"
        }) | Error: ${f.error || "none"}`,
      );
    }
  }

  console.log("\n" + "=".repeat(70));
}

// Main execution
async function main() {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!baseUrl || !serviceKey) {
    console.error(
      "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
    Deno.exit(1);
  }

  console.log(
    `Running ${fixtures.cases.length} test cases against ${baseUrl}...`,
  );

  const results: TestResult[] = [];
  for (const testCase of fixtures.cases) {
    if (process.stdout?.write) {
      process.stdout.write(`  Testing ${testCase.id}...`);
    } else {
      console.log(`  Testing ${testCase.id}...`);
    }
    const result = await runTest(testCase, baseUrl, serviceKey);
    console.log(
      ` ${result.match ? "✓" : "✗"} (${result.latencyMs}ms) ${result.candidateSource || "?"}`,
    );
    results.push(result);

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const metrics = computeMetrics(results);
  printReport(metrics);

  // Save detailed results to JSON
  const outputPath = "./category-test-results.json";
  const output = {
    timestamp: new Date().toISOString(),
    metrics,
    results,
  };

  try {
    await Deno.writeTextFile(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nDetailed results saved to ${outputPath}`);
  } catch {
    console.log("\nResults (JSON):", JSON.stringify(output, null, 2));
  }
}

main();
