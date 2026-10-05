import { beforeEach, describe, expect, test, vi } from "vitest";
import { buildConditionPolicy } from "../../supabase/functions/_helpers/conditionPolicy";

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

import { exportEbayFileExchange } from "@/lib/exportCSV";

function listing(condition: string) {
  return {
    title: "Test item",
    description: "Test description",
    priceMin: 12,
    priceMax: 12,
    ebayCategoryId: "123",
    itemSpecifics: { Brand: "Example" },
    condition,
  };
}

function availablePolicy(
  itemConditions: Parameters<typeof buildConditionPolicy>[1]["itemConditions"],
) {
  return buildConditionPolicy("123", {
    categoryId: "123",
    itemConditionRequired: true,
    itemConditions,
  });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("eBay CSV condition policy", () => {
  let downloadedBlob: Blob | undefined;
  let createObjectUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invokeMock.mockReset();
    downloadedBlob = undefined;
    createObjectUrl = vi.fn((blob: Blob) => {
      downloadedBlob = blob;
      return "blob:test";
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  test("always fetches the exact category policy and exports its exact condition ID", async () => {
    invokeMock.mockResolvedValue({
      data: {
        conditionPolicy: availablePolicy([
          {
            conditionId: 2010,
            conditionDescription: "Excellent - Refurbished",
          },
        ]),
      },
      error: null,
    });

    await exportEbayFileExchange(listing("EXCELLENT_REFURBISHED"));

    expect(invokeMock).toHaveBeenCalledWith("category-lookup", {
      body: { action: "conditions", categoryId: "123" },
    });
    expect(downloadedBlob).toBeDefined();
    expect(await readBlob(downloadedBlob!)).toContain(",2010,FixedPrice,");
  });

  test("refuses required descriptors rather than downloading invalid CSV", async () => {
    invokeMock.mockResolvedValue({
      data: {
        conditionPolicy: availablePolicy([
          {
            conditionId: 2750,
            conditionDescription: "Graded",
            conditionDescriptors: [
              {
                conditionDescriptorId: "grade",
                conditionDescriptorName: "Grade",
                conditionDescriptorConstraint: {
                  usage: "REQUIRED",
                  mode: "SELECTION_ONLY",
                  cardinality: "SINGLE",
                },
                conditionDescriptorValues: [
                  {
                    conditionDescriptorValueId: "10",
                    conditionDescriptorValueName: "10",
                  },
                ],
              },
            ],
          },
        ]),
      },
      error: null,
    });

    await expect(exportEbayFileExchange(listing("LIKE_NEW"))).rejects.toThrow(
      "CSV export cannot represent required condition descriptors: Grade",
    );
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  test("does not substitute a static ID when the category policy is unavailable", async () => {
    invokeMock.mockResolvedValue({
      data: { conditionPolicy: { status: "unavailable", categoryId: "123" } },
      error: null,
    });

    await expect(exportEbayFileExchange(listing("NEW"))).rejects.toThrow(
      "The selected condition cannot be exported",
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
