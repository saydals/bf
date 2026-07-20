# Flight Plan Tab Layout Fix - TODO

## Step 1: FlightPlanTab.vue
- [x] Change grid from `grid-rows-[1.4fr_1fr_2.2fr]` to `grid-rows-[auto_auto_1fr]`
- [x] Add aspect-ratio wrapper div around FlightPlanMap with `aspect-ratio: 2/1`, `min-height: 280px`, `max-height: 55vh`
- [x] Remove flex wrapper divs that force `height: 100%` on elevation row
- [x] Update `:deep()` styles to remove `height: 100% !important` from elevation-profile

## Step 2: FlightPlanMap.vue
- [x] No changes needed - existing `height: 100%` works with aspect-ratio wrapper

## Step 3: ElevationProfile.vue
- [x] Remove `fill` prop from UiBox so it doesn't force `height: 100%`
- [x] Let it size naturally based on content (only grows for error messages)

## Step 4: Verify
- [x] FlightPlanTab.vue - grid `grid-rows-[auto_auto_1fr]`, aspect-ratio wrapper(2:1, min 280px, max 55vh)
- [x] FlightPlanMap.vue - existing `height: 100%` works with aspect-ratio wrapper
- [x] ElevationProfile.vue - `fill` prop removed, `flex: 1` removed, natural sizing
