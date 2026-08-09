#!/usr/bin/env node

/**
 * Setup E2E test user in Supabase.
 * Usage: node scripts/setup-test-user.js
 */

const TEST_EMAIL = "qa0000000000test@test.sovereignlistingsuite.com";
const TEST_PASSWORD = "QATest123!@#";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY",
  );
  process.exit(1);
}

async function main() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: "test-user",
      },
    }),
  });

  if (response.ok) {
    console.log(`Test user ready: ${TEST_EMAIL}`);
    return;
  }

  const body = await response.text();

  if (response.status === 422 && body.includes("email_exists")) {
    console.log(`Test user already exists: ${TEST_EMAIL}`);
    return;
  }

  throw new Error(`Failed to create test user (${response.status}): ${body}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
