# eBay Condition Codes - Quick Reference

## Overview

eBay deprecated the old condition codes in 2024. This document provides a quick reference for the current valid condition codes and how to use them.

---

## Current Valid Condition Codes

### New Items

| Condition Code | Condition ID | Description |
|----------------|--------------|-------------|
| `NEW` | 1000 | Brand new, unused, unopened item in original packaging |
| `LIKE_NEW` | 2750 | Like new condition. May be open box but unused |
| `NEW_OTHER` | 1500 | New without original packaging or tags |
| `NEW_WITH_DEFECTS` | 1750 | New item with minor cosmetic defects |

### Refurbished Items

| Condition Code | Condition ID | Description |
|----------------|--------------|-------------|
| `CERTIFIED_REFURBISHED` | 2000 | Professionally refurbished and certified to work like new |
| `EXCELLENT_REFURBISHED` | 2010 | Refurbished to excellent working condition |
| `VERY_GOOD_REFURBISHED` | 2020 | Refurbished to very good working condition |
| `GOOD_REFURBISHED` | 2030 | Refurbished to good working condition |
| `SELLER_REFURBISHED` | 2500 | Seller-refurbished item in good working condition |

### Pre-Owned Items

| Condition Code | Condition ID | Description |
|----------------|--------------|-------------|
| `PRE_OWNED_GOOD` | 3000 | Pre-owned item in good condition. May show minor signs of wear |
| `PRE_OWNED_FAIR` | 5000 | Pre-owned item in fair condition. Shows visible signs of wear |
| `PRE_OWNED_POOR` | 6000 | Pre-owned item in poor condition. Heavy wear or cosmetic damage |
| `FOR_PARTS_OR_NOT_WORKING` | 7000 | Item is not fully functional. Sold for parts or repair |

---

## Deprecated Condition Codes (DO NOT USE)

### ❌ These codes are no longer valid:

| Deprecated Code | Replace With |
|-----------------|--------------|
| `USED_EXCELLENT` | `PRE_OWNED_GOOD` |
| `USED_VERY_GOOD` | `PRE_OWNED_GOOD` |
| `USED_GOOD` | `PRE_OWNED_FAIR` |
| `USED_ACCEPTABLE` | `PRE_OWNED_POOR` |

### ⚠️ Important Notes:
- If you use deprecated codes, the system will automatically migrate them
- However, it's best to use the correct codes directly
- The system includes a `LEGACY_CONDITION_MAP` for backwards compatibility

---

## How the System Handles Conditions

### 1. Default Condition
- The default condition is now `PRE_OWNED_GOOD`
- This replaces the old default of `USED_EXCELLENT`

### 2. Condition Mapping
The system uses three mappings:

1. **CONDITION_ID_MAP**: Maps condition codes to numeric IDs (required by some categories)
2. **CONDITION_DESCRIPTIONS**: Maps condition codes to human-readable descriptions
3. **LEGACY_CONDITION_MAP**: Maps deprecated codes to current equivalents

### 3. Migration Process
When a draft is published:
1. Raw condition value is retrieved from draft
2. Legacy condition map checks if it's deprecated
3. Migrated to current equivalent if needed
4. Condition ID and description are looked up
5. Both string enum and numeric ID are sent to eBay

---

## Usage Examples

### React Component (Dropdown)
```typescript
const conditions = [
  { value: 'NEW', label: 'New' },
  { value: 'LIKE_NEW', label: 'Like New' },
  { value: 'PRE_OWNED_GOOD', label: 'Pre-Owned - Good' },
  { value: 'PRE_OWNED_FAIR', label: 'Pre-Owned - Fair' },
  // ... etc
];

<select value={condition} onChange={e => setCondition(e.target.value)}>
  {conditions.map(c => (
    <option key={c.value} value={c.value}>{c.label}</option>
  ))}
</select>
```

### Draft Object
```typescript
const draft = {
  title: 'Vintage Silver Dollar',
  description: '1921 Morgan Dollar in good condition',
  condition: 'PRE_OWNED_GOOD',  // ✅ Correct
  // condition: 'USED_EXCELLENT', // ❌ Deprecated
  price: 50.00,
  // ... other fields
};
```

### Edge Function (Processing)
```typescript
const rawCondition = condition || 'PRE_OWNED_GOOD';
const conditionEnum = LEGACY_CONDITION_MAP[rawCondition] ?? rawCondition;
const conditionId = CONDITION_ID_MAP[conditionEnum] ?? 3000;
const conditionDesc = CONDITION_DESCRIPTIONS[conditionEnum] ?? '';

// Send to eBay
const inventoryBody = {
  condition: conditionEnum,           // String enum
  conditionDescription: conditionDesc, // Human-readable
  // Some categories also need:
  // conditionId: conditionId           // Numeric ID
};
```

---

## Category-Specific Considerations

### Some categories have limited condition options:
- **Coins & Currency**: Typically `PRE_OWNED_GOOD` or higher
- **Electronics**: Often `NEW` or various refurbished grades
- **Clothing**: All conditions available
- **Collectibles**: Often `PRE_OWNED_GOOD` or higher

### Check eBay's category guide:
- https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum
- Or use eBay's Category API to get valid conditions for a specific category

---

## Troubleshooting

### Error: "Invalid condition value"
**Cause**: Using deprecated condition code
**Solution**: Update to current condition code

### Error: "Condition not allowed for category"
**Cause**: Selected condition not valid for the category
**Solution**: Choose a different condition or category

### Error: "Missing condition description"
**Cause**: Condition code not in CONDITION_DESCRIPTIONS map
**Solution**: Add description to the map in edge function

---

## Best Practices

1. **Always use current condition codes** - Don't rely on legacy migration
2. **Select the most accurate condition** - Be honest about item condition
3. **Provide detailed descriptions** - Condition description should be specific
4. **Use appropriate condition for category** - Some categories have restrictions
5. **Test with low-value items first** - Verify condition accuracy

---

## Reference Links

- eBay Condition Enum Documentation: https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum
- eBay Category-Specific Conditions: Use the Category API to check
- eBay Seller Hub - Condition Guidelines: https://www.ebay.com/help/selling/listings/setting-up-listing/adding-item-condition?id=4126

---

## Summary

✅ **13 current condition codes** (NEW, LIKE_NEW, NEW_OTHER, NEW_WITH_DEFECTS, CERTIFIED_REFURBISHED, EXCELLENT_REFURBISHED, VERY_GOOD_REFURBISHED, GOOD_REFURBISHED, SELLER_REFURBISHED, PRE_OWNED_GOOD, PRE_OWNED_FAIR, PRE_OWNED_POOR, FOR_PARTS_OR_NOT_WORKING)

❌ **4 deprecated condition codes** (USED_EXCELLENT, USED_VERY_GOOD, USED_GOOD, USED_ACCEPTABLE)

🔄 **Legacy migration** automatically converts deprecated codes to current equivalents

📝 **Human-readable descriptions** are automatically generated and sent to eBay

🔢 **Numeric condition IDs** are also sent for category compatibility