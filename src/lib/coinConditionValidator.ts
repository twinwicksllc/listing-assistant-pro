/**
 * Strict validation for coin condition data per eBay June 2026 mandate.
 * Ensures graded and raw coins meet exact data structure requirements.
 */

import type { CoinConditionDetail } from "@/types/listing";

// Exact set of grading companies allowed by eBay
const ALLOWED_GRADING_COMPANIES = new Set([
  "PCGS",
  "NGC",
  "ANACS",
  "ICG",
  "CAC",
  "ICCS",
]);

// Exact set of raw condition tiers mandated by eBay
const ALLOWED_RAW_CONDITIONS = new Set([
  "Uncirculated",
  "Extremely Fine to About Uncirculated",
  "Fine to Very Fine",
  "Below Fine",
]);

// Grade pattern validation: MS-65, PR-70, AU-58, etc.
// Must be LETTER_GRADE SPACE NUMERIC_GRADE, optionally with suffix (DCAM, CAMEO, RD, etc.)
const VALID_GRADE_PATTERN = /^[A-Z]{1,3}\s+\d{1,2}(?:\s+[A-Z]{2,})?$/;

export interface CoinConditionValidationError {
  field: string;
  message: string;
  code: string;
}

export interface CoinConditionValidationResult {
  valid: boolean;
  errors: CoinConditionValidationError[];
  normalized?: CoinConditionDetail;
}

/**
 * Validate a graded coin condition object against eBay mandates.
 * Returns validation result with normalized value if valid.
 */
export function validateGradedCoinCondition(
  detail: unknown,
): CoinConditionValidationResult {
  const errors: CoinConditionValidationError[] = [];

  // Type guard
  if (!detail || typeof detail !== "object") {
    return {
      valid: false,
      errors: [
        {
          field: "detail",
          message: "Graded coin detail must be an object",
          code: "INVALID_TYPE",
        },
      ],
    };
  }

  const obj = detail as Record<string, unknown>;

  // Validate type field
  if (obj.type !== "graded") {
    errors.push({
      field: "type",
      message: 'Type must be exactly "graded"',
      code: "INVALID_TYPE",
    });
  }

  // Validate gradingCompany
  const company = String(obj.gradingCompany ?? "").trim();
  if (!company) {
    errors.push({
      field: "gradingCompany",
      message: "Grading company is required",
      code: "MISSING_REQUIRED_FIELD",
    });
  } else if (!ALLOWED_GRADING_COMPANIES.has(company)) {
    errors.push({
      field: "gradingCompany",
      message: `Grading company must be one of: ${Array.from(ALLOWED_GRADING_COMPANIES).join(", ")}. Got: "${company}"`,
      code: "INVALID_ENUM_VALUE",
    });
  }

  // Validate grade
  const grade = String(obj.grade ?? "").trim();
  if (!grade) {
    errors.push({
      field: "grade",
      message: "Grade is required (e.g., MS 65, PR 70, AU 58)",
      code: "MISSING_REQUIRED_FIELD",
    });
  } else if (!VALID_GRADE_PATTERN.test(grade)) {
    errors.push({
      field: "grade",
      message: `Grade format invalid. Expected: "MS 65", "PR 70", etc. Got: "${grade}"`,
      code: "INVALID_FORMAT",
    });
  }

  // Validate certification number (optional, but if present must be string)
  const certNum = obj.certificationNumber;
  if (certNum !== undefined && certNum !== null && typeof certNum !== "string") {
    errors.push({
      field: "certificationNumber",
      message: "Certification number must be a string or omitted",
      code: "INVALID_TYPE",
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Return normalized detail
  return {
    valid: true,
    errors: [],
    normalized: {
      type: "graded",
      gradingCompany: company as "PCGS" | "NGC" | "ANACS" | "ICG" | "CAC" | "ICCS",
      grade,
      certificationNumber: certNum ? String(certNum).trim() : undefined,
    },
  };
}

/**
 * Validate a raw (ungraded) coin condition object against eBay mandates.
 * Strictly enforces the four allowed condition tiers.
 */
export function validateRawCoinCondition(
  detail: unknown,
): CoinConditionValidationResult {
  const errors: CoinConditionValidationError[] = [];

  // Type guard
  if (!detail || typeof detail !== "object") {
    return {
      valid: false,
      errors: [
        {
          field: "detail",
          message: "Raw coin detail must be an object",
          code: "INVALID_TYPE",
        },
      ],
    };
  }

  const obj = detail as Record<string, unknown>;

  // Validate type field
  if (obj.type !== "raw") {
    errors.push({
      field: "type",
      message: 'Type must be exactly "raw"',
      code: "INVALID_TYPE",
    });
  }

  // Validate rawCondition - STRICT matching only
  const condition = String(obj.rawCondition ?? "").trim();
  if (!condition) {
    errors.push({
      field: "rawCondition",
      message: "Raw condition is required",
      code: "MISSING_REQUIRED_FIELD",
    });
  } else if (!ALLOWED_RAW_CONDITIONS.has(condition)) {
    errors.push({
      field: "rawCondition",
      message: `Raw condition must be exactly one of:\n  - Uncirculated\n  - Extremely Fine to About Uncirculated\n  - Fine to Very Fine\n  - Below Fine\nGot: "${condition}"`,
      code: "INVALID_ENUM_VALUE",
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Return normalized detail
  return {
    valid: true,
    errors: [],
    normalized: {
      type: "raw",
      rawCondition: condition as
        | "Uncirculated"
        | "Extremely Fine to About Uncirculated"
        | "Fine to Very Fine"
        | "Below Fine",
    },
  };
}

/**
 * Main validator: routes to graded or raw validation based on type.
 */
export function validateCoinConditionDetail(
  detail: unknown,
): CoinConditionValidationResult {
  if (!detail || typeof detail !== "object") {
    return {
      valid: false,
      errors: [
        {
          field: "detail",
          message: "Coin condition detail must be an object with type: 'graded' or 'raw'",
          code: "INVALID_TYPE",
        },
      ],
    };
  }

  const obj = detail as Record<string, unknown>;
  const type = String(obj.type ?? "").trim();

  if (type === "graded") {
    return validateGradedCoinCondition(detail);
  } else if (type === "raw") {
    return validateRawCoinCondition(detail);
  } else {
    return {
      valid: false,
      errors: [
        {
          field: "type",
          message: 'Type must be either "graded" or "raw"',
          code: "INVALID_TYPE",
        },
      ],
    };
  }
}

/**
 * Format validation errors into a user-friendly message.
 */
export function formatValidationErrors(errors: CoinConditionValidationError[]): string {
  if (errors.length === 0) return "";
  return errors.map((e) => `${e.field}: ${e.message}`).join("\n");
}

/**
 * Check if a condition detail is complete and valid.
 * Used by UI to enable/disable publish button.
 */
export function isCoinConditionValid(detail: CoinConditionDetail | null | undefined): boolean {
  if (!detail) return false;
  const result = validateCoinConditionDetail(detail);
  return result.valid;
}

/**
 * Get a human-readable description of a coin condition.
 */
export function describeCoinCondition(detail: CoinConditionDetail): string {
  if (detail.type === "graded") {
    const cert = detail.certificationNumber ? ` (Cert: ${detail.certificationNumber})` : "";
    return `${detail.gradingCompany} ${detail.grade}${cert}`;
  }
  return `Raw - ${detail.rawCondition}`;
}
