#!/usr/bin/env node

/**
 * Phase 2 Verification: Test Coin Condition Validation
 *
 * This script tests the coin condition validation logic locally before publishing.
 * Run with: npm run test:coin-condition
 *
 * Tests:
 * 1. Graded coins: Valid company + grade combo
 * 2. Graded coins: Invalid company rejection
 * 3. Graded coins: Missing grade rejection
 * 4. Raw coins: Valid tier selection
 * 5. Raw coins: Invalid tier rejection
 * 6. Raw coins: Missing selection rejection
 */

const GRADING_COMPANIES = ["PCGS", "NGC", "ANACS", "ICG", "CAC", "ICCS"];
const RAW_CONDITION_TIERS = [
  "Uncirculated",
  "Extremely Fine to About Uncirculated",
  "Fine to Very Fine",
  "Below Fine",
];

/**
 * Validate graded coin structure
 */
function validateGradedCoin(company, grade, certNumber) {
  const errors = [];

  if (!company || !GRADING_COMPANIES.includes(company)) {
    errors.push(
      `Invalid grading company: "${company}". Must be one of: ${GRADING_COMPANIES.join(", ")}`,
    );
  }

  if (!grade || grade.trim().length === 0) {
    errors.push("Grade is required (e.g., 'MS 65', 'PR 70 DCAM')");
  } else if (!/^[A-Z]{1,3}\s*\d{1,2}(\s+[A-Z]{2,})?$/.test(grade.trim())) {
    errors.push(
      `Grade format invalid: "${grade}". Must match pattern: LETTER_CODE + NUMBER (e.g., 'MS 65', 'PR 70 DCAM')`,
    );
  }

  if (
    certNumber !== undefined &&
    certNumber !== null &&
    certNumber.trim().length > 0
  ) {
    if (certNumber.trim().length < 3) {
      errors.push(
        "Certification number must be at least 3 characters if provided",
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate raw (ungraded) coin structure
 */
function validateRawCoin(condition) {
  const errors = [];

  if (!condition || condition.trim().length === 0) {
    errors.push("Raw condition tier is required");
  } else if (!RAW_CONDITION_TIERS.includes(condition)) {
    errors.push(
      `Invalid raw condition: "${condition}". Must be one of:\n${RAW_CONDITION_TIERS.map(
        (t) => `  - ${t}`,
      ).join("\n")}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format test output
 */
function formatTest(name, passed, message) {
  const status = passed ? "✓ PASS" : "✗ FAIL";
  const color = passed ? "\x1b[32m" : "\x1b[31m";
  const reset = "\x1b[0m";
  console.log(`${color}${status}${reset} ${name}`);
  if (message) {
    console.log(`     ${message}`);
  }
}

/**
 * Main test suite
 */
function runTests() {
  console.log("\n=== Phase 2: Coin Condition Validation Tests ===\n");

  let passCount = 0;
  let failCount = 0;

  // Test 1: Valid graded coin (PCGS MS 65)
  {
    const result = validateGradedCoin("PCGS", "MS 65", undefined);
    const passed = result.valid;
    if (passed) passCount++;
    else failCount++;
    formatTest(
      "Test 1: Graded Coin (PCGS, MS 65, no cert)",
      passed,
      passed ? "Accepted" : result.errors.join("; "),
    );
  }

  // Test 2: Valid graded coin with cert number
  {
    const result = validateGradedCoin("NGC", "PR 70 DCAM", "123456789");
    const passed = result.valid;
    if (passed) passCount++;
    else failCount++;
    formatTest(
      "Test 2: Graded Coin (NGC, PR 70 DCAM, with cert)",
      passed,
      passed ? "Accepted" : result.errors.join("; "),
    );
  }

  // Test 3: Invalid grading company
  {
    const result = validateGradedCoin("INVALID", "MS 65", undefined);
    const passed = !result.valid; // Should fail
    if (passed) passCount++;
    else failCount++;
    formatTest(
      "Test 3: Reject invalid grading company (INVALID)",
      passed,
      result.errors[0],
    );
  }

  // Test 4: Missing grade
  {
    const result = validateGradedCoin("PCGS", "", undefined);
    const passed = !result.valid; // Should fail
    if (passed) passCount++;
    else failCount++;
    formatTest("Test 4: Reject missing grade", passed, result.errors[0]);
  }

  // Test 5: Invalid grade format
  {
    const result = validateGradedCoin("PCGS", "65 MS", undefined); // Reversed
    const passed = !result.valid; // Should fail
    if (passed) passCount++;
    else failCount++;
    formatTest(
      "Test 5: Reject invalid grade format (65 MS)",
      passed,
      result.errors[0],
    );
  }

  // Test 6: Valid raw condition (Uncirculated)
  {
    const result = validateRawCoin("Uncirculated");
    const passed = result.valid;
    if (passed) passCount++;
    else failCount++;
    formatTest(
      "Test 6: Raw Coin (Uncirculated)",
      passed,
      passed ? "Accepted" : result.errors.join("; "),
    );
  }

  // Test 7: Valid raw condition (Extremely Fine to About Uncirculated)
  {
    const result = validateRawCoin("Extremely Fine to About Uncirculated");
    const passed = result.valid;
    if (passed) passCount++;
    else failCount++;
    formatTest(
      "Test 7: Raw Coin (Extremely Fine to About Uncirculated)",
      passed,
      passed ? "Accepted" : result.errors.join("; "),
    );
  }

  // Test 8: Invalid raw condition
  {
    const result = validateRawCoin("Slightly Used"); // Not a valid tier
    const passed = !result.valid; // Should fail
    if (passed) passCount++;
    else failCount++;
    formatTest(
      "Test 8: Reject invalid raw condition (Slightly Used)",
      passed,
      result.errors[0].split("\n")[0],
    );
  }

  // Test 9: Missing raw condition
  {
    const result = validateRawCoin("");
    const passed = !result.valid; // Should fail
    if (passed) passCount++;
    else failCount++;
    formatTest(
      "Test 9: Reject missing raw condition",
      passed,
      result.errors[0],
    );
  }

  // Test 10: Cert number too short
  {
    const result = validateGradedCoin("PCGS", "MS 65", "ab");
    const passed = !result.valid; // Should fail
    if (passed) passCount++;
    else failCount++;
    formatTest(
      "Test 10: Reject short cert number (< 3 chars)",
      passed,
      result.errors[1] || result.errors[0],
    );
  }

  console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

// Run tests
runTests();
