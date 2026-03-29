#!/usr/bin/env python3
"""Update test fixtures with verified leaf category IDs."""
import json

with open('/workspace/listing-assistant-pro/supabase/functions/_tests/category-test-fixtures.json', 'r') as f:
    fixtures = json.load(f)

# Map of old expected IDs to corrected verified leaf IDs
corrections = {
    # Coins - old IDs that are non-leaf or reassigned
    "coin-05": {"expectedCategoryId": "177653", "expectedBreadcrumb": "Coins & Paper Money > Bullion > Silver > Coins"},
    "coin-11": {"expectedCategoryId": "177652", "expectedBreadcrumb": "Coins & Paper Money > Bullion > Gold > Coins"},
    "coin-12": {"expectedCategoryId": "177652", "expectedBreadcrumb": "Coins & Paper Money > Bullion > Gold > Coins"},
    "coin-13": {"expectedCategoryId": "41084", "expectedBreadcrumb": "Coins & Paper Money > Coins: US > Small Cents > Indian Head (1859-1909)"},
    "coin-14": {"expectedCategoryId": "3383", "expectedBreadcrumb": "Coins & Paper Money > Coins: Canada > Dollars"},
    
    # Trading cards - 213 is non-leaf, eBay uses 261328 for singles
    "card-01": {"expectedCategoryId": "261328", "expectedBreadcrumb": "Sports Mem, Cards & Fan Shop > Sports Trading Cards > Trading Card Singles"},
    "card-04": {"expectedCategoryId": "183454", "expectedBreadcrumb": "Toys & Hobbies > Collectible Card Games > CCG Individual Cards"},
    "card-06": {"expectedCategoryId": "261328", "expectedBreadcrumb": "Sports Mem, Cards & Fan Shop > Sports Trading Cards > Trading Card Singles"},
    "card-09": {"expectedCategoryId": "183454", "expectedBreadcrumb": "Toys & Hobbies > Collectible Card Games > CCG Individual Cards"},
    "card-12": {"expectedCategoryId": "261328", "expectedBreadcrumb": "Sports Mem, Cards & Fan Shop > Sports Trading Cards > Trading Card Singles"},
    "card-13": {"expectedCategoryId": "183050", "expectedBreadcrumb": "Collectibles > Non-Sport Trading Cards > Trading Card Singles"},
    "card-15": {"expectedCategoryId": "261332", "expectedBreadcrumb": "Sports Mem, Cards & Fan Shop > Sports Trading Cards > Sealed Trading Card Boxes"},
    
    # Toys - old parent IDs replaced with verified leaves
    "toy-01": {"expectedCategoryId": "440", "expectedBreadcrumb": "Toys & Hobbies > Beanbag Plush > Ty > Beanie Babies-Original > Retired"},
    "toy-02": {"expectedCategoryId": "149372", "expectedBreadcrumb": "Collectibles > Collectible Figures & Supplies > Collectible Figures & Bobbleheads"},
    "toy-03": {"expectedCategoryId": "19006", "expectedBreadcrumb": "Toys & Hobbies > Building Toys > LEGO (R) Building Toys > LEGO (R) Complete Sets & Packs"},
    "toy-04": {"expectedCategoryId": "440", "expectedBreadcrumb": "Toys & Hobbies > Beanbag Plush > Ty > Beanie Babies-Original > Retired"},
    "toy-05": {"expectedCategoryId": "180506", "expectedBreadcrumb": "Toys & Hobbies > Diecast & Toy Vehicles > Cars, Trucks & Vans > Contemporary Manufacture"},
    "toy-06": {"expectedCategoryId": "261068", "expectedBreadcrumb": "Toys & Hobbies > Action Figures & Accessories > Action Figures"},
    "toy-07": {"expectedCategoryId": "180349", "expectedBreadcrumb": "Toys & Hobbies > Games > Board & Traditional Games > Contemporary Manufacture"},
    "toy-08": {"expectedCategoryId": "158786", "expectedBreadcrumb": "Toys & Hobbies > Stuffed Animals > Jellycat"},
    "toy-09": {"expectedCategoryId": "149372", "expectedBreadcrumb": "Collectibles > Collectible Figures & Supplies > Collectible Figures & Bobbleheads"},
    "toy-10": {"expectedCategoryId": "440", "expectedBreadcrumb": "Toys & Hobbies > Beanbag Plush > Ty > Beanie Babies-Original > Retired"},
    "toy-11": {"expectedCategoryId": "19006", "expectedBreadcrumb": "Toys & Hobbies > Building Toys > LEGO (R) Building Toys > LEGO (R) Complete Sets & Packs"},
    "toy-12": {"expectedCategoryId": "180102", "expectedBreadcrumb": "Dolls & Bears > Dolls, Clothing & Accessories > Doll Clothes & Accessories > Houses & Furniture"},
    "toy-13": {"expectedCategoryId": "230", "expectedBreadcrumb": "Toys & Hobbies > Stuffed Animals > Other Stuffed Animals"},
    "toy-14": {"expectedCategoryId": "261068", "expectedBreadcrumb": "Toys & Hobbies > Action Figures & Accessories > Action Figures"},
    "toy-15": {"expectedCategoryId": "19183", "expectedBreadcrumb": "Toys & Hobbies > Puzzles > Contemporary Puzzles > Jigsaw"},
    
    # Other - parent IDs replaced with verified leaves
    "other-01": {"expectedCategoryId": "165654", "expectedBreadcrumb": "Collectibles > Pens & Writing Instruments > Typewriters"},
    "other-04": {"expectedCategoryId": "15709", "expectedBreadcrumb": "Clothing, Shoes & Accessories > Men > Men's Shoes > Athletic Shoes"},
    "other-05": {"expectedCategoryId": "133701", "expectedBreadcrumb": "Home & Garden > Kitchen, Dining & Bar > Small Kitchen Appliances > Countertop Mixers"},
    "other-06": {"expectedCategoryId": "31388", "expectedBreadcrumb": "Consumer Electronics > Cameras & Photo > Digital Cameras"},
    "other-07": {"expectedCategoryId": "168134", "expectedBreadcrumb": "Home & Garden > Tools & Workshop Equipment > Power Tools > Impact Drivers"},
    "other-08": {"expectedCategoryId": "261186", "expectedBreadcrumb": "Books & Magazines > Books"},
    "other-09": {"expectedCategoryId": "31387", "expectedBreadcrumb": "Jewelry & Watches > Watches, Parts & Accessories > Watches > Wristwatches"},
    "other-10": {"expectedCategoryId": "37978", "expectedBreadcrumb": "Home & Garden > Rugs & Carpets"},
    "other-12": {"expectedCategoryId": "261975", "expectedBreadcrumb": "Jewelry & Watches > Fine Jewelry > Rings > Engagement Rings"},
    "other-13": {"expectedCategoryId": "360", "expectedBreadcrumb": "Art > Art Prints"},
    "other-14": {"expectedCategoryId": "261259", "expectedBreadcrumb": "Home & Garden > Furniture > Chairs"},
    "other-15": {"expectedCategoryId": "11071", "expectedBreadcrumb": "Consumer Electronics > TV, Video & Home Audio > TVs"},
}

updated = 0
for case in fixtures["cases"]:
    if case["id"] in corrections:
        for key, value in corrections[case["id"]].items():
            case[key] = value
        updated += 1

fixtures["description"] = "60 test cases for category lookup validation (verified leaf IDs as of 2025-01)"

with open('/workspace/listing-assistant-pro/supabase/functions/_tests/category-test-fixtures.json', 'w') as f:
    json.dump(fixtures, f, indent=2, ensure_ascii=False)

print(f"Updated {updated} test cases with verified leaf category IDs")