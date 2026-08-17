import { describe, it, expect } from "vitest";
import { isAdminEmail } from "@/lib/adminEmails";

/**
 * Regression tests for the owner-role resolution defect that made every
 * ownerOnly route (Dashboard, Billing, P&L Report, Reprice Rules) bounce back
 * to /home for the org owner.
 *
 * Root cause: AuthContext.refreshOrg() selected from org_members with
 * `.limit(1).single()` and no `user_id` filter. The "Org members can view
 * members" RLS policy deliberately allows any member to read every row of
 * their org, so as soon as an org had more than one member the query could
 * return a teammate's row. When that row was a 'lister', the owner was demoted
 * client-side.
 *
 * The selection logic below mirrors the fixed implementation.
 */

type MemberRow = { org_id: string; role: "owner" | "lister"; user_id: string };

/** Mirrors the corrected selection in refreshOrg(). */
function resolveMembership(rows: MemberRow[], callerId: string) {
  const scoped = rows.filter((r) => r.user_id === callerId);
  if (scoped.length === 0) return null;
  return scoped.find((m) => m.role === "owner") ?? scoped[0];
}

/** Mirrors the pre-fix behaviour: unscoped, take whatever comes back first. */
function resolveMembershipBuggy(rows: MemberRow[]) {
  return rows[0] ?? null;
}

const OWNER = "owner-user-id";
const LISTER = "lister-user-id";

describe("refreshOrg membership resolution", () => {
  const multiMemberOrg: MemberRow[] = [
    // Row order from Postgres is not guaranteed; the lister sorting first is
    // exactly the case that broke production.
    { org_id: "org-1", role: "lister", user_id: LISTER },
    { org_id: "org-1", role: "owner", user_id: OWNER },
  ];

  it("resolves the owner's own role when a teammate's row sorts first", () => {
    const membership = resolveMembership(multiMemberOrg, OWNER);
    expect(membership?.role).toBe("owner");
  });

  it("reproduces the defect: the unscoped query returned the wrong member", () => {
    const wrong = resolveMembershipBuggy(multiMemberOrg);
    expect(wrong?.user_id).toBe(LISTER);
    expect(wrong?.role).toBe("lister");
  });

  it("still resolves a lister correctly - the fix must not promote anyone", () => {
    const membership = resolveMembership(multiMemberOrg, LISTER);
    expect(membership?.role).toBe("lister");
  });

  it("returns null when the caller has no membership row", () => {
    expect(resolveMembership(multiMemberOrg, "stranger")).toBeNull();
  });

  it("prefers the owner row when a user belongs to two orgs", () => {
    // A user can own a personal org and be a lister in an org they joined.
    const dualMembership: MemberRow[] = [
      { org_id: "joined-org", role: "lister", user_id: OWNER },
      { org_id: "personal-org", role: "owner", user_id: OWNER },
    ];
    const membership = resolveMembership(dualMembership, OWNER);
    expect(membership?.role).toBe("owner");
    expect(membership?.org_id).toBe("personal-org");
  });

  it("handles a single-member org, which is why this went unnoticed", () => {
    const soloOrg: MemberRow[] = [
      { org_id: "org-1", role: "owner", user_id: OWNER },
    ];
    // Both implementations agree here - the defect only surfaces once a
    // second member exists, which is why it appeared after team changes.
    expect(resolveMembership(soloOrg, OWNER)?.role).toBe("owner");
    expect(resolveMembershipBuggy(soloOrg)?.role).toBe("owner");
  });
});

describe("isAdminEmail", () => {
  it("matches the configured admin address", () => {
    expect(isAdminEmail("twinwicksllc@gmail.com")).toBe(true);
  });

  it("matches regardless of casing returned by the identity provider", () => {
    expect(isAdminEmail("TwinWicksLLC@Gmail.com")).toBe(true);
    expect(isAdminEmail("TWINWICKSLLC@GMAIL.COM")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isAdminEmail("  twinwicksllc@gmail.com  ")).toBe(true);
  });

  it("rejects non-admin addresses", () => {
    expect(isAdminEmail("someone@example.com")).toBe(false);
  });

  it("rejects empty, null and undefined without matching a blank entry", () => {
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});
