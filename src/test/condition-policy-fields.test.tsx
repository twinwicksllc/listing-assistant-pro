import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  buildConditionPolicy,
  validateConditionSelection,
} from "../../supabase/functions/_helpers/conditionPolicy";
import { ConditionPolicyFields } from "@/components/analyze/ConditionPolicyFields";

const policy = buildConditionPolicy("123", {
  categoryId: "123",
  itemConditionRequired: true,
  itemConditions: [
    {
      conditionId: "1000",
      conditionDescription: "New Factory Sealed",
      conditionDescriptors: [
        {
          conditionDescriptorId: "material",
          conditionDescriptorName: "Material",
          conditionDescriptorConstraint: {
            usage: "REQUIRED",
            mode: "SELECTION_ONLY",
            cardinality: "SINGLE",
          },
          conditionDescriptorValues: [
            {
              conditionDescriptorValueId: "gold",
              conditionDescriptorValueName: "14k Gold",
            },
            {
              conditionDescriptorValueId: "silver",
              conditionDescriptorValueName: "Sterling Silver",
            },
          ],
        },
        {
          conditionDescriptorId: "marking",
          conditionDescriptorName: "Marking",
          conditionDescriptorConstraint: {
            usage: "REQUIRED",
            mode: "FREE_TEXT",
            maxLength: 8,
            applicableToConditionDescriptorIds: ["material"],
          },
        },
        {
          conditionDescriptorId: "features",
          conditionDescriptorName: "Features",
          conditionDescriptorConstraint: {
            mode: "SELECTION_ONLY",
            cardinality: "MULTI",
          },
          conditionDescriptorValues: [
            {
              conditionDescriptorValueId: "stamped",
              conditionDescriptorValueName: "Stamped",
              conditionDescriptorValueConstraints: [
                {
                  applicableToConditionDescriptorId: "material",
                  applicableToConditionDescriptorValueIds: ["gold"],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("ConditionPolicyFields", () => {
  test("renders exact policy labels and IDs plus constrained descriptor controls", () => {
    const onConditionChange = vi.fn();
    const onDescriptorsChange = vi.fn();
    const descriptors = [{ name: "material", values: ["gold"] }];
    const validation = validateConditionSelection(
      policy,
      "123",
      "1000",
      descriptors,
    );

    const { rerender } = render(
      <ConditionPolicyFields
        policy={policy}
        categoryId="123"
        condition="1000"
        descriptors={descriptors}
        validation={validation}
        loading={false}
        onConditionChange={onConditionChange}
        onDescriptorsChange={onDescriptorsChange}
      />,
    );

    expect(
      screen
        .getByRole("option", { name: "New Factory Sealed" })
        .getAttribute("value"),
    ).toBe("1000");
    expect(
      screen.getByRole("option", { name: "14k Gold" }).getAttribute("value"),
    ).toBe("gold");
    expect(
      screen
        .getByRole("option", { name: "Sterling Silver" })
        .getAttribute("value"),
    ).toBe("silver");
    expect(screen.getByLabelText("Marking")).toHaveAttribute("maxLength", "8");
    expect(screen.getByLabelText("Marking")).not.toBeDisabled();
    expect(screen.getByLabelText("Stamped")).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText("Condition"), {
      target: { value: "1000" },
    });
    expect(onConditionChange).toHaveBeenCalledWith("1000");
    fireEvent.change(screen.getByLabelText("Marking"), {
      target: { value: "Inside" },
    });
    expect(onDescriptorsChange).toHaveBeenCalledWith([
      { name: "material", values: ["gold"] },
      { name: "marking", additionalInfo: "Inside" },
    ]);

    rerender(
      <ConditionPolicyFields
        policy={policy}
        categoryId="123"
        condition="1000"
        descriptors={[{ name: "material", values: ["silver"] }]}
        validation={validation}
        loading={false}
        onConditionChange={onConditionChange}
        onDescriptorsChange={onDescriptorsChange}
      />,
    );
    expect(screen.getByLabelText("Stamped")).toBeDisabled();
    expect(screen.getByText("Requires Material first.")).toBeInTheDocument();
  });

  test("communicates loading and unavailable policy states", () => {
    const props = {
      policy,
      categoryId: "123",
      condition: "1000",
      descriptors: [],
      validation: { valid: false, errors: ["Condition policy is unavailable"] },
      onConditionChange: vi.fn(),
      onDescriptorsChange: vi.fn(),
    };

    const { rerender } = render(<ConditionPolicyFields {...props} loading />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading condition requirements",
    );
    expect(screen.queryByLabelText("Condition")).not.toBeInTheDocument();

    rerender(
      <ConditionPolicyFields {...props} loading={false} categoryId="999" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Condition requirements are unavailable",
    );
    expect(screen.queryByLabelText("Condition")).not.toBeInTheDocument();
  });
});
