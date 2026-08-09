import type { BulkTemplate, BulkTemplateId } from "@/types/bulk-listing";

// ─── Template definitions ──────────────────────────────────────────────────────

export const BULK_TEMPLATES: Record<BulkTemplateId, BulkTemplate> = {
  coins: {
    id: "coins",
    label: "Coins & Currency",
    icon: "🪙",
    description: "US & world coins, silver/gold bullion, paper currency",
    defaultCategoryId: "11116",
    defaultCondition: "USED_EXCELLENT",
    columns: [
      "title",
      "condition",
      "price",
      "quantity",
      "categoryId",
      "imageUrl1",
      "imageUrl2",
    ],
    itemSpecificKeys: [
      "Year",
      "Mint Location",
      "Grade",
      "Denomination",
      "Composition",
      "Certification",
    ],
    sampleRows: [
      {
        title: "1921 Morgan Silver Dollar MS-63 Uncirculated",
        condition: "USED_EXCELLENT",
        price: "89.99",
        quantity: "1",
        categoryId: "39464",
        imageUrl1: "",
        Item_Specific_Year: "1921",
        "Item_Specific_Mint Location": "Philadelphia",
        Item_Specific_Grade: "MS-63",
        Item_Specific_Denomination: "$1",
        Item_Specific_Composition: "Silver",
        Item_Specific_Certification: "Uncertified",
      },
      {
        title: "1964 Kennedy Half Dollar BU Roll 20 Coins 90% Silver",
        condition: "USED_EXCELLENT",
        price: "219.99",
        quantity: "1",
        categoryId: "11116",
        imageUrl1: "",
        Item_Specific_Year: "1964",
        Item_Specific_Composition: "Silver",
        Item_Specific_Denomination: "50C",
        Item_Specific_Certification: "Uncertified",
      },
    ],
  },

  electronics: {
    id: "electronics",
    label: "Electronics",
    icon: "📱",
    description: "Phones, tablets, laptops, accessories, audio equipment",
    defaultCategoryId: "15032",
    defaultCondition: "USED_EXCELLENT",
    columns: [
      "title",
      "condition",
      "price",
      "quantity",
      "categoryId",
      "imageUrl1",
      "imageUrl2",
      "imageUrl3",
    ],
    itemSpecificKeys: [
      "Brand",
      "Model",
      "Storage Capacity",
      "Color",
      "Connectivity",
      "MPN",
    ],
    sampleRows: [
      {
        title: "Apple iPhone 13 128GB Space Gray Unlocked Excellent",
        condition: "USED_EXCELLENT",
        price: "399.99",
        quantity: "1",
        categoryId: "15032",
        imageUrl1: "",
        Item_Specific_Brand: "Apple",
        Item_Specific_Model: "iPhone 13",
        "Item_Specific_Storage Capacity": "128 GB",
        Item_Specific_Color: "Space Gray",
        Item_Specific_Connectivity: "Unlocked",
      },
    ],
  },

  clothing: {
    id: "clothing",
    label: "Clothing & Shoes",
    icon: "👕",
    description: "Men's, women's, kids clothing, shoes, accessories",
    defaultCategoryId: "11450",
    defaultCondition: "USED_EXCELLENT",
    columns: [
      "title",
      "condition",
      "price",
      "quantity",
      "categoryId",
      "imageUrl1",
      "imageUrl2",
    ],
    itemSpecificKeys: [
      "Brand",
      "Size",
      "Color",
      "Style",
      "Material",
      "Department",
    ],
    sampleRows: [
      {
        title: "Nike Air Max 90 White Black Men's Size 10 Running Shoes",
        condition: "USED_EXCELLENT",
        price: "79.99",
        quantity: "1",
        categoryId: "15709",
        imageUrl1: "",
        Item_Specific_Brand: "Nike",
        Item_Specific_Size: "10",
        Item_Specific_Color: "White/Black",
        Item_Specific_Style: "Athletic",
        Item_Specific_Department: "Men",
      },
    ],
  },

  books: {
    id: "books",
    label: "Books & Media",
    icon: "📚",
    description: "Books, magazines, DVDs, vinyl records, video games",
    defaultCategoryId: "267",
    defaultCondition: "USED_EXCELLENT",
    columns: [
      "title",
      "condition",
      "price",
      "quantity",
      "categoryId",
      "imageUrl1",
    ],
    itemSpecificKeys: [
      "Author",
      "ISBN",
      "Format",
      "Publication Year",
      "Genre",
      "Language",
    ],
    sampleRows: [
      {
        title: "The Great Gatsby F. Scott Fitzgerald Scribner Paperback",
        condition: "USED_EXCELLENT",
        price: "8.99",
        quantity: "1",
        categoryId: "267",
        imageUrl1: "",
        Item_Specific_Author: "F. Scott Fitzgerald",
        Item_Specific_Format: "Paperback",
        Item_Specific_Language: "English",
        Item_Specific_Genre: "Classic Literature",
      },
    ],
  },

  generic: {
    id: "generic",
    label: "General / Other",
    icon: "📦",
    description: "Any category — blank template with all fields available",
    defaultCategoryId: "",
    defaultCondition: "USED_EXCELLENT",
    columns: [
      "title",
      "description",
      "condition",
      "price",
      "quantity",
      "categoryId",
      "format",
      "imageUrl1",
      "imageUrl2",
      "fulfillmentPolicyId",
      "paymentPolicyId",
      "returnPolicyId",
      "cogs",
      "consignor",
    ],
    itemSpecificKeys: ["Brand", "Type", "Color", "Material", "Size"],
    sampleRows: [
      {
        title: "Your Item Title Here (max 80 characters)",
        description: "Optional description — leave blank for AI generation",
        condition: "USED_EXCELLENT",
        price: "19.99",
        quantity: "1",
        categoryId: "99",
        format: "FIXED_PRICE",
        imageUrl1: "https://...",
        cogs: "5.00",
        consignor: "",
      },
    ],
  },
};

// ─── CSV download generator ────────────────────────────────────────────────────

export function generateTemplateCsv(templateId: BulkTemplateId): string {
  const template = BULK_TEMPLATES[templateId];
  const itemSpecificHeaders = template.itemSpecificKeys.map(
    (k) => `Item_Specific_${k}`,
  );

  // Build header row
  const fieldLabels: Record<string, string> = {
    title: "Title",
    description: "Description",
    condition: "Condition",
    price: "Price",
    quantity: "Quantity",
    categoryId: "Category_ID",
    format: "Format",
    auctionStartPrice: "Auction_Start_Price",
    buyItNowPrice: "Buy_It_Now_Price",
    imageUrl1: "Image_URL_1",
    imageUrl2: "Image_URL_2",
    imageUrl3: "Image_URL_3",
    imageUrl4: "Image_URL_4",
    imageUrl5: "Image_URL_5",
    imageUrl6: "Image_URL_6",
    imageUrl7: "Image_URL_7",
    imageUrl8: "Image_URL_8",
    fulfillmentPolicyId: "Fulfillment_Policy_ID",
    paymentPolicyId: "Payment_Policy_ID",
    returnPolicyId: "Return_Policy_ID",
    cogs: "COGS",
    consignor: "Consignor",
  };

  const headers = [
    ...template.columns.map((c) => fieldLabels[c] || c),
    ...itemSpecificHeaders,
  ];

  // Build sample rows
  const dataRows = template.sampleRows.map((row) => {
    return headers.map((h) => {
      // Try direct mapping
      const fieldKey = Object.keys(fieldLabels).find(
        (k) => fieldLabels[k] === h,
      );
      if (fieldKey && row[fieldKey] !== undefined) return `"${row[fieldKey]}"`;
      if (row[h] !== undefined) return `"${row[h]}"`;
      return '""';
    });
  });

  const lines = [
    headers.map((h) => `"${h}"`).join(","),
    ...dataRows.map((r) => r.join(",")),
  ];

  return lines.join("\n");
}

export function downloadTemplateCsv(templateId: BulkTemplateId): void {
  const csv = generateTemplateCsv(templateId);
  const template = BULK_TEMPLATES[templateId];
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bulk_template_${templateId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
