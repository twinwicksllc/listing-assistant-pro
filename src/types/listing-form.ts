import { z } from "zod";
import type { SelectedPolicies } from "./ebay-policies";

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
  });

export type ListingFormData = z.infer<typeof listingFormSchema>;

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
  policies: SelectedPolicies
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
