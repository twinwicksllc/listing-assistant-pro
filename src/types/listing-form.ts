import { z } from "zod";
import type { SelectedPolicies } from "./ebay-policies";
import type { CoinConditionDetail } from "./listing";
import {
  isCoinConditionDetailRequired,
  isCoinConditionDetailComplete,
} from "./listing";

/**
 * Validation schema for listing form submission
 * Includes conditional validation based on listing format
 */
export const listingFormSchema = z
  .object({
    title: z
      .string()
      .min(1, "Title is required")
      .max(80, "Title must be 80 characters or less")
      .trim(),
    description: z
      .string()
      .min(10, "Description must be at least 10 characters")
      .min(1, "Description is required")
      .trim(),
    ebayCategoryId: z
      .string()
      .min(1, "eBay category is required (generate listing to set)"),
    listingFormat: z.enum(["FIXED_PRICE", "AUCTION"]),
    listingPrice: z
      .number()
      .nonnegative("Listing price must be $0 or higher")
      .optional(),
    auctionStartPrice: z
      .number()
      .nonnegative("Starting bid must be $0 or higher")
      .optional(),
    auctionBuyItNow: z
      .number()
      .nonnegative("Buy It Now price must be $0 or higher")
      .optional()
      .nullable(),
    auctionBuyItNowEnabled: z.boolean(),
    // Policy validation - all three required
    fulfillmentPolicyId: z
      .string()
      .nullable()
      .refine((val) => val !== null, {
        message: "Shipping policy is required",
      }),
    paymentPolicyId: z
      .string()
      .nullable()
      .refine((val) => val !== null, {
        message: "Payment policy is required",
      }),
    returnPolicyId: z
      .string()
      .nullable()
      .refine((val) => val !== null, {
        message: "Return policy is required",
      }),
    // Coin condition details (required at publish time for coin categories)
    coinConditionDetail: z.any().optional(),
    coinConditionDetailRequired: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // Conditional validation for listing price based on format
    if (data.listingFormat === "FIXED_PRICE") {
      if (!data.listingPrice || data.listingPrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["listingPrice"],
          message: "Listing price is required and must be greater than $0",
        });
      }
    } else if (data.listingFormat === "AUCTION") {
      if (!data.auctionStartPrice || data.auctionStartPrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["auctionStartPrice"],
          message: "Starting bid is required and must be greater than $0",
        });
      }
      // If Buy It Now is enabled, validate the price
      if (
        data.auctionBuyItNowEnabled &&
        (!data.auctionBuyItNow || data.auctionBuyItNow <= 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["auctionBuyItNow"],
          message: "Buy It Now price is required and must be greater than $0",
        });
      }
    }
    // eBay June 2026 Coin Condition Mandate: Strict validation at form level
    if (
      data.coinConditionDetailRequired &&
      !isCoinConditionDetailComplete(data.coinConditionDetail)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coinConditionDetail"],
        message:
          "Coin condition details are REQUIRED for this category per eBay June 2026 mandate. " +
          "Specify graded (PCGS/NGC/ANACS/ICG/CAC/ICCS with grade) or ungraded (standardized condition tier).",
      });
    }
  });

export type ListingFormData = z.infer<typeof listingFormSchema>;

/**
 * Validates coin condition payload at publish time.
 * Ensures graded coins have valid company (PCGS/NGC/etc.) and grade.
 * Ensures raw coins have one of 4 standardized eBay tiers.
 */
export const validateCoinConditionPayload = (
  coinCondition: CoinConditionDetail | null | undefined,
  isCoinCategory: boolean,
): { valid: boolean; error?: string } => {
  if (!isCoinCategory) return { valid: true };
  if (!coinCondition) {
    return {
      valid: false,
      error: "Coin listing requires condition details (graded or ungraded).",
    };
  }
  if (!isCoinConditionDetailComplete(coinCondition)) {
    return {
      valid: false,
      error: "Coin condition is incomplete. Fill all required fields.",
    };
  }
  if (coinCondition.type === "graded") {
    const allowed = ["PCGS", "NGC", "ANACS", "ICG", "CAC", "ICCS"];
    if (!allowed.includes(coinCondition.gradingCompany)) {
      return {
        valid: false,
        error: `Invalid grading company: ${coinCondition.gradingCompany}`,
      };
    }
  }
  if (coinCondition.type === "raw") {
    const allowed = [
      "Uncirculated",
      "Extremely Fine to About Uncirculated",
      "Fine to Very Fine",
      "Below Fine",
    ];
    if (!allowed.includes(coinCondition.rawCondition)) {
      return {
        valid: false,
        error: `Invalid raw condition: ${coinCondition.rawCondition}`,
      };
    }
  }
  return { valid: true };
};

/**
 * Helper to check if all policies are selected
 *
 * Can be used in other components to gate UI based on policy selection status.
 * Example: Display a warning if policies are not selected before navigating away.
 */
export const arePoliciesSelected = (policies: SelectedPolicies): boolean => {
  return !!(
    policies.fulfillmentPolicyId &&
    policies.paymentPolicyId &&
    policies.returnPolicyId
  );
};

/**
 * Helper to get policy validation errors
 */
export const getPolicyValidationErrors = (
  policies: SelectedPolicies,
): Record<string, string> => {
  const errors: Record<string, string> = {};

  if (!policies.fulfillmentPolicyId) {
    errors.fulfillmentPolicyId = "Shipping policy is required";
  }
  if (!policies.paymentPolicyId) {
    errors.paymentPolicyId = "Payment policy is required";
  }
  if (!policies.returnPolicyId) {
    errors.returnPolicyId = "Return policy is required";
  }

  return errors;
};
