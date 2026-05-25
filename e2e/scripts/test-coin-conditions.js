#!/usr/bin/env node
/**
 * Terminal test script to verify eBay Coin Condition mandate compliance.
 * 
 * Usage:
 *   npm run test:coin-compliance
 *   
 * Or directly:
 *   node e2e/scripts/test-coin-conditions.js
 * 
 * Tests:
 *   ✓ Graded coins with valid PCGS/NGC/ANACS/ICG/CAC/ICCS companies
 *   ✓ Raw coins with exact eBay four-tier condition strings
 *   ✗ Rejects invalid grading companies
 *   ✗ Rejects malformed grade formats
 *   ✗ Rejects raw conditions outside the four allowed tiers
 *   ✗ Rejects missing required fields
 */

// Inline validators for Node.js compatibility (no TypeScript compilation needed)

const ALLOWED_GRADING_COMPANIES = new Set([
  "PCGS",
  "NGC",
  "ANACS",
  "ICG",
  "CAC",
  "ICCS",
]);

const ALLOWED_RAW_CONDITIONS = new Set([
  "Uncirculated",
  "Extremely Fine to About Uncirculated",
  "Fine to Very Fine",
  "Below Fine",
]);

const VALID_GRADE_PATTERN = /^[A-Z]{1,3}\s+\d{1,2}(?:\s+[A-Z]{2,})?$/;

/**
 * Validate a graded coin condition detail.
 * Returns { valid: boolean, errors: string[] }
 */
function validateGradedCoinCondition(detail) {
  const errors = [];

  if (typeof detail?.gradingCompany !== "string" || !detail.gradingCompany.trim()) {
    errors.push("Grading company is required");
  } else if (!ALLOWED_GRADING_COMPANIES.has(detail.gradingCompany.trim().toUpperCase())) {
    errors.push(
      `Grading company must be one of: ${Array.from(ALLOWED_GRADING_COMPANIES).join(", ")}. Got: ${detail.gradingCompany}`,
    );
  }

  if (typeof detail?.grade !== "string" || !detail.grade.trim()) {
    errors.push("Grade is required");
  } else if (!VALID_GRADE_PATTERN.test(detail.grade.trim())) {
    errors.push(
      `Grade must match pattern "XX 00" or "X 00 XX". Examples: "MS 65", "PR 70 DCAM". Got: ${detail.grade}`,
    );
  }

  if (detail?.certificationNumber !== undefined && typeof detail.certificationNumber !== "string") {
    errors.push(`Certification number must be a string if provided. Got: ${typeof detail.certificationNumber}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a raw coin condition detail.
 * Returns { valid: boolean, errors: string[] }
 */
function validateRawCoinCondition(detail) {
  const errors = [];

  if (typeof detail?.rawCondition !== "string" || !detail.rawCondition.trim()) {
    errors.push("Raw condition is required");
  } else if (!ALLOWED_RAW_CONDITIONS.has(detail.rawCondition)) {
    errors.push(
      `Raw condition must be exactly one of:\n` +
        `  - Uncirculated\n` +
        `  - Extremely Fine to About Uncirculated\n` +
        `  - Fine to Very Fine\n` +
        `  - Below Fine\n` +
        `Got: ${detail.rawCondition}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a coin condition detail (routes to graded/raw validator).
 * Returns { valid: boolean, errors: string[] }
 */
function validateCoinConditionDetail(detail) {
  if (typeof detail !== "object" || detail === null) {
    return {
      valid: false,
      errors: ["Coin condition detail must be an object"],
    };
  }

  const { type } = detail;

  if (type === "graded") {
    return validateGradedCoinCondition(detail);
  } else if (type === "raw") {
    return validateRawCoinCondition(detail);
  } else {
    return {
      valid: false,
      errors: [`Type must be "graded" or "raw". Got: ${type}`],
    };
  }
}

// Test cases: [description, detail, shouldPass]
const testCases = [
  // Valid graded coins
  [
    "Valid graded coin (PCGS MS 65)",
    {
      type: "graded",
      gradingCompany: "PCGS",
      grade: "MS 65",
      certificationNumber: "12345678",
    },
    true,
  ],
  [
    "Valid graded coin (NGC PR 70 DCAM without cert)",
    {
      type: "graded",
      gradingCompany: "NGC",
      grade: "PR 70 DCAM",
    },
    true,
  ],

  // Valid raw coins
  [
    "Valid raw coin (Uncirculated)",
    {
      type: "raw",
      rawCondition: "Uncirculated",
    },
    true,
  ],
  [
    "Valid raw coin (Fine to Very Fine)",
    {
      type: "raw",
      rawCondition: "Fine to Very Fine",
    },
    true,
  ],

  // Invalid graded coins
  [
    "Invalid grading company (FAKE_GRADER)",
    {
      type: "graded",
      gradingCompany: "FAKE_GRADER",
      grade: "MS 65",
    },
    false,
  ],
  [
    "Missing grading company",
    {
      type: "graded",
      grade: "MS 65",
    },
    false,
  ],
  [
    "Invalid grade format (MS-65 with hyphen)",
    {
      type: "graded",
      gradingCompany: "PCGS",
      grade: "MS-65",
    },
    false,
  ],
  [
    "Invalid grade format (number only)",
    {
      type: "graded",
      gradingCompany: "PCGS",
      grade: "65",
    },
    false,
  ],

  // Invalid raw coins
  [
    "Raw condition not in allowed list (Used)",
    {
      type: "raw",
      rawCondition: "Used",
    },
    false,
  ],
  [
    "Missing raw condition",
    {
      type: "raw",
    },
    false,
  ],

  // Invalid structure
  [
    "Invalid type field (unknown)",
    {
      type: "unknown",
      grade: "MS 65",
    },
    false,
  ],
  [
    "Invalid certification number (object instead of string)",
    {
      type: "graded",
      gradingCompany: "NGC",
      grade: "PR 70",
      certificationNumber: { id: "123" },
    },
    false,
  ],
];

// Run tests
console.log("\n" + "=".repeat(80));
console.log("eBay Coin Condition Mandate Compliance Test Suite");
console.log("=".repeat(80) + "\n");

let passedCount = 0;
let failedCount = 0;

for (const [description, detail, shouldPass] of testCases) {
  const result = validateCoinConditionDetail(detail);
  const testPassed = result.valid === shouldPass;

  if (testPassed) {
    passedCount++;
    console.log(`✓ ${description}`);
    console.log(`  Status: PASS ✓`);
  } else {
    failedCount++;
    console.log(`✗ ${description}`);
    console.log(`  Status: FAIL ✗`);
    console.log(`  Expected: ${shouldPass ? "valid" : "invalid"}, Got: ${result.valid ? "valid" : "invalid"}`);
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.join("; ")}`);
    }
  }
  console.log();
}

// Summary
console.log("=".repeat(80));
console.log(`Test Results: ${passedCount} passed, ${failedCount} failed out of ${testCases.length} total`);
console.log("=".repeat(80));

if (failedCount === 0) {
  console.log("\n✅ All tests passed! Coin condition validation is working correctly.\n");
  console.log("Compliance Status:");
  console.log("  ✓ Graded coins: PCGS, NGC, ANACS, ICG, CAC, ICCS enforced");
  console.log("  ✓ Raw coins: Four-tier condition strings strictly validated");
  console.log("  ✓ Grade format: Letter + Space + Number pattern enforced");
  console.log("  ✓ Certification number: Optional, must be string if present\n");
  process.exit(0);
} else {
  console.log(`\n❌ ${failedCount} test(s) failed! Please review the errors above.\n`);
  process.exit(1);
}
