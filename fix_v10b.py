"""Fix the remaining items: melt value fee buffer in analyze-item, and pricing guidance in prompt."""

with open('supabase/functions/analyze-item/index.ts', 'r') as f:
    ana = f.read()

# 1. Fix melt value enforcement in analyze-item (add 1.19x fee buffer)
old_melt = '''        meltValue = parseFloat((spotPrice * listing.metalWeightOz).toFixed(2));
        // Enforce: priceMin must never be below melt value
        if (listing.priceMin < meltValue) {
          console.warn(`priceMin ${listing.priceMin} below melt value ${meltValue} — correcting`);
          listing.priceMin = meltValue;
          // Also bump priceMax if it's somehow below melt
          if (listing.priceMax < meltValue) {
            listing.priceMax = parseFloat((meltValue * 1.1).toFixed(2));
          }
        }'''

new_melt = '''        meltValue = parseFloat((spotPrice * listing.metalWeightOz).toFixed(2));
        // Enforce: priceMin must never be below melt value PLUS eBay fees.
        // ~13.25% FVF + ~2.9% payment processing = ~16% total fees. Use 1.19x for margin.
        const feeAdjustedFloor = parseFloat((meltValue * 1.19).toFixed(2));
        if (listing.priceMin < feeAdjustedFloor) {
          console.warn(`priceMin ${listing.priceMin} below fee-adjusted melt floor ${feeAdjustedFloor} (melt: ${meltValue}) — correcting`);
          listing.priceMin = feeAdjustedFloor;
          // Also bump priceMax if it's somehow below the floor
          if (listing.priceMax < feeAdjustedFloor) {
            listing.priceMax = parseFloat((feeAdjustedFloor * 1.1).toFixed(2));
          }
        }'''

if old_melt in ana:
    ana = ana.replace(old_melt, new_melt, 1)
    print("✅ analyze-item: melt floor updated with 1.19x fee buffer")
else:
    print("❌ analyze-item: melt enforcement block not found")
    # Show what's around line 578
    lines = ana.split('\n')
    for i, l in enumerate(lines[575:590], 576):
        print(f"  {i}: {l}")

# 2. Update pricing guidance in system prompt to mention fee buffer
old_pricing = '''Melt Value Floor: priceMin must NEVER fall below the melt value for precious metals.
Current live spot prices: Gold $${spotGold.toFixed(2)}/oz | Silver $${spotSilver.toFixed(2)}/oz | Platinum $${spotPlatinum.toFixed(2)}/oz

Premium multipliers:
- Generic bullion (plain bar/round, no theme) → 1.05x–1.15x melt
- Popular themes (Disney, Star Wars, sports teams) → 1.5x–4x melt
- Key dates / high-grade certified coins → significant numismatic premium'''

new_pricing = '''Melt Value Floor: priceMin must NEVER fall below the melt value PLUS eBay fees.
eBay charges ~13.25% final value fee + ~2.9% payment processing = ~16% total. Use 1.19x melt as the minimum floor so listings at priceMin still cover melt after fees.
Current live spot prices: Gold $${spotGold.toFixed(2)}/oz | Silver $${spotSilver.toFixed(2)}/oz | Platinum $${spotPlatinum.toFixed(2)}/oz

Fee-adjusted melt floor = meltValue × 1.19

Premium multipliers (applied ON TOP of fee-adjusted floor):
- Generic bullion (plain bar/round, no theme) → 1.05x–1.15x melt (plus fees)
- Popular themes (Disney, Star Wars, sports teams) → 1.5x–4x melt
- Key dates / high-grade certified coins → significant numismatic premium'''

if old_pricing in ana:
    ana = ana.replace(old_pricing, new_pricing, 1)
    print("✅ analyze-item: pricing guidance updated with fee buffer explanation")
else:
    print("❌ analyze-item: pricing guidance section not found")

with open('supabase/functions/analyze-item/index.ts', 'w') as f:
    f.write(ana)

# Final verification
print(f"\n✅ analyze-item: 1.19x fee buffer present: {'1.19' in ana}")
print(f"✅ analyze-item: feeAdjustedFloor present: {'feeAdjustedFloor' in ana}")
print(f"✅ analyze-item: file size: {len(ana)} chars")