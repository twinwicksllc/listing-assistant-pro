import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

// The E2E suite creates an auth user and runs a full AI analysis, so it must never reach the
// production project or the project reused for the new app. These checks read the workflow
// files as YAML and assert the properties that keep that true.

type Step = {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  if?: string;
};
type Job = {
  environment?: string;
  needs?: string | string[];
  if?: string;
  steps?: Step[];
};
type Workflow = { jobs: Record<string, Job> };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const load = (name: string): Workflow =>
  parse(
    readFileSync(resolve(root, ".github/workflows", name), "utf8"),
  ) as Workflow;
const text = (name: string) =>
  readFileSync(resolve(root, ".github/workflows", name), "utf8");

const WORKFLOWS = {
  "e2e-pr-smoke.yml": { gated: "smoke-tests", requiresBaseUrl: false },
  "e2e-full-lifecycle.yml": { gated: "full-lifecycle", requiresBaseUrl: true },
} as const;

describe.each(Object.entries(WORKFLOWS))("%s", (file, meta) => {
  const wf = load(file);

  it("never uses the QA environment or the QA project", () => {
    const src = text(file);
    expect(src).not.toMatch(/environment:\s*QA\b/);
    expect(src).not.toContain("QA_BASE_URL");
    // The QA project reference may appear only in the list of projects the suite refuses to use.
    const mentions = src
      .split(/\r?\n/)
      .filter((l) => l.includes("majmvgakczrpcwgxgulj"));
    for (const line of mentions) {
      expect(line, `${file}: ${line.trim()}`).toMatch(/E2E_FORBIDDEN_REFS:/);
    }
  });

  it("runs every job in the dedicated E2E environment", () => {
    for (const [name, job] of Object.entries(wf.jobs)) {
      if (job.environment !== undefined) {
        expect(job.environment, `${file}:${name}`).toBe("E2E");
      }
    }
    expect(wf.jobs["e2e-config"].environment).toBe("E2E");
    expect(wf.jobs[meta.gated].environment).toBe("E2E");
  });

  it("reads only E2E_-prefixed secrets and variables, so nothing can fall back to production", () => {
    // A GitHub environment with no value for a name falls back to the repository-level secret
    // of the same name, and those hold the production values.
    const refs = [
      ...text(file).matchAll(/\b(secrets|vars)\.([A-Za-z0-9_]+)/g),
    ].map((m) => m[2]);
    expect(refs.length).toBeGreaterThan(0);
    const unprefixed = refs.filter(
      (r) => !r.startsWith("E2E_") && r !== "GITHUB_TOKEN",
    );
    expect(unprefixed).toEqual([]);
  });

  it("gates the test job on the configuration check", () => {
    const job = wf.jobs[meta.gated];
    const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
    expect(needs).toContain("e2e-config");
    expect(job.if).toContain("needs.e2e-config.outputs.configured == 'true'");
  });

  it("runs the configuration check with the production project forbidden", () => {
    const step = wf.jobs["e2e-config"].steps?.find((s) =>
      s.run?.includes("e2e-config-check.sh"),
    );
    expect(step).toBeDefined();
    // Both the production project and the QA project that now belongs to the ListrAssistr app.
    const forbidden = String(step?.env?.E2E_FORBIDDEN_REFS ?? "").split(",");
    expect(forbidden.sort()).toEqual([
      "majmvgakczrpcwgxgulj",
      "wcednzaxmxwfiijzmjmx",
    ]);
    if (meta.requiresBaseUrl)
      expect(step?.env?.E2E_REQUIRE_BASE_URL).toBe("yes");
  });

  it("does not run the test job through always() or a status override", () => {
    // always()/failure() on the job would run it even when the configuration job said no.
    expect(wf.jobs[meta.gated].if).not.toMatch(
      /always\(\)|failure\(\)|cancelled\(\)/,
    );
  });
});

describe("retired QA workflows", () => {
  // The QA project now belongs to the ListrAssistr app. A scheduled run or a manual deploy from
  // this repository would put legacy functions and issues there.
  it("the QA drift reminder has no schedule and its job never runs, even when started by hand", () => {
    const wf = parse(
      readFileSync(
        resolve(root, ".github/workflows/qa-drift-reminder.yml"),
        "utf8",
      ),
    ) as { on: Record<string, unknown>; jobs: Record<string, Job> };
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    // A manual run would otherwise open an issue pointing at the refused QA deploy.
    for (const [name, job] of Object.entries(wf.jobs)) {
      expect(job.if, `job ${name}`).toBe(false);
    }
  });

  it("the QA function deploy refuses to run, before any step that could deploy", () => {
    const wf = parse(
      readFileSync(
        resolve(root, ".github/workflows/deploy-functions-qa.yml"),
        "utf8",
      ),
    ) as {
      on: Record<string, unknown>;
      jobs: Record<string, { steps: Step[] }>;
    };
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    const first = wf.jobs.deploy.steps[0];
    expect(first.name).toBe("Refuse to deploy");
    expect(first.run).toContain("exit 1");
  });
});

describe("the production project reference", () => {
  it("matches the project this repository deploys to", () => {
    const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
    expect(config).toMatch(/project_id\s*=\s*"wcednzaxmxwfiijzmjmx"/);
  });
});
