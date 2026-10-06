# Compact Monad workspace — design QA

final result: passed

Date: 2026-10-05. Branch: `design/monad-ui`. This report supersedes the earlier light dashboard review, which the user rejected. The selected visual is `exec-62044902-d542-4ada-8c59-8131e01fbafe.png`.

## Source and browser evidence

- Source visual truth: `docs/design/images/split-reference.png` (1488 × 1056 pixels).
- Implementation: `docs/design/images/split-desktop.png`, captured with Playwright Chromium at 1488 × 1056 CSS px, device density 1, logged out, default sorting, first strategy selected.
- Full-view comparison: `docs/design/images/split-comparison.png` (2976 × 1056), source left and rendered implementation right; neither is stretched. Both opened and visually inspected together.
- Responsive evidence: `split-mobile-390.png`, `split-mobile-320.png`, `split-detail-mobile.png` in the same directory. Mobile viewport heights are 844 CSS px; full-page captures include content below the fold, with navigation fixed at its actual viewport position.
- Focused regions inspected: list numeric columns, selected boundary, inspector metrics and investment form; mobile capital figures and comparison dock. Private account captures remain in ignored `.data/ux-review/`.

![Selected reference and implementation](docs/design/images/split-comparison.png)

## Findings and fixes

1. P1: prior light cards and welcome hero did not match the selected operational workspace. Replaced with a 64px icon rail, 58px header, dense rows, and a 500px inspector at the reference viewport. All six current strategies fit in the initial desktop screen. Evidence: final combined screenshot.
2. P2: initial split had an overly narrow inspector and small return values caused by CSS specificity. Corrected the panel proportion and numeric typography; preserved tabular numerals. Evidence: final desktop screenshot.
3. P2: row description and status stacked into excessive height. Grouped manager and status in a byline, clamped the secondary desktop description, retained the full description in the inspector/detail. Final rows are approximately 104px high.
4. P2: shared detail statistic layout squeezed mobile manager capital into broken lines. Scoped horizontal layout to the summary ribbon; portfolio statistics now wrap as independent labeled values. Evidence: final 320px detail screenshot.
5. P2: desktop minimum columns could collide with the inspector near 1180px. Reduced fixed column widths and uses a 380px inspector through 1350px. No document overflow at 1180/1280px. Below 1180px, selecting a row opens the existing detail route.
6. P2: dark chart hover could inherit a white tooltip. Scoped tooltip foreground, background and border to dark semantic tokens.

No actionable P0/P1/P2 remains in the verified scope.

## Design surfaces and intentional differences

- Typography: Inter/Noto Sans KR body, Roboto Mono for figures; restrained weights and compact labels. Reference hierarchy retained, with 26px inspector title and 25px inspector metrics. Korean fallback and wrapping inspected. Generated image letterforms are interpreted with available fonts.
- Layout: flat rows, thin dividers, 4–6px corner radii, no large introductory cards. Mobile uses labeled metrics, bottom navigation and a direct investment jump in the detail route. No separate mobile reference was provided; this is the responsive adaptation requested by the user.
- Colors: Monad primary #6E54FF and lavender #DDD7FE, extended near-black purple product surfaces. Semantic green/red remain alongside text status and signed return values. Muted copy remains visibly distinct on dark surfaces.
- Assets: existing MM wordmark and Lucide line icons retained; no raster illustration exists in the chosen target requiring generation. The background is a flat product surface rather than reproducing image-generation texture.
- Copy and data: existing live API values, no invented performance. Missing statistics remain unknown. TEE-only metrics, test AUSD, pending activation and settlement timing remain explicit.
- Product adaptations: manager identity is grouped under the strategy name; explicit compare checkboxes preserve the existing three-way comparison feature; an inspector link opens full performance/history. Real balance and settlement details remain in the investment form, unlike the simplified mockup.

## Verification

- `npm test`: 28 passed.
- `npm run build`: passed; existing Lucide module directive warnings are non-fatal.
- `scripts/platform-ux-browser.mjs`: public search/reset/filter/sort, three-way comparison and focus, desktop inspector selection, full detail deep-link/reload; manager and investor login, private portfolio through encrypted relay, account Escape/focus, investment confirmation/Escape, management tabs, invalid allocation blocking, session restoration and wallet-change cleanup. Passed, zero page JavaScript errors. Transaction submission disabled.
- Playwright visual sweep: 30 combinations across 1488, 1280, 1180, 768, 390, 320px and home/explore/detail/assets/manage; zero document overflow and zero page JavaScript errors. Mobile comparison limit and focus, reset and empty-search state passed.
- Final mobile row navigation to actual detail route confirmed; final screenshots inspected after statistic-layout repair.

## Follow-up polish and limits

Optional P3: self-host approved font subsets. No fresh deposits, trades or withdrawals were sent. Safari, physical mobile devices and a full screen-reader audit remain outside this pass. Earlier `after-*` and `comparison-*` images are historical light-design evidence; `split-*` files represent this release.

## Production verification

Code commit `2e89658` deployed successfully to https://mm-zkquant.vercel.app. Immutable deployment: https://mm-zkquant-4zcwzqprc-cosmoserys-projects.vercel.app (Vercel READY).

Post-deployment Playwright verified desktop row selection/inspector update, comparison focus, 390px row-to-detail navigation and deep-link reload. No document overflow or page JavaScript errors. Production screenshots in `.data/design/production-split-desktop.png` and `production-split-mobile.png` were inspected. Original main workspace uncommitted work remains excluded and unchanged.

## 2026-10-06 — official brand typography and palette correction

final result: passed

Visual truth: https://www.monad.xyz/brand-and-media-kit, captured in `docs/design/images/brand-source-type.png` and `brand-source-colors.png` (1440 × 1000 CSS/pixel dimensions, density 1). The page specifies Britti Sans for headings, Inter for body and Roboto Mono for labels/buttons/links. Its exact primary anchors are #6E54FF, #DDD7FE, #0E091C, #000000, #FFFFFF; secondary anchors are #85E6FF, #B9E3F9, #FF8EE4, #FFAE45.

Implementation evidence: `brand-desktop.png` (1488px wide, viewport 1488 × 1056, full page), `brand-mobile.png` (320px wide, viewport 320 × 844, full page). `brand-comparison.png` places the 1440px official palette screenshot beside the 1488px implementation at native resolution, no rescaling. These are compared for palette/type roles, not marketing-page layout; the previously selected split workspace layout remains the layout reference. All source and implementation captures were opened for inspection.

Resolved P2: the previous heading font was Inter, and product surfaces/status colors contained arbitrary non-brand hues. Added the actual official Britti Sans font, preload and dedicated heading token; applied Roboto Mono to UI labels/actions, retained Inter body. Replaced arbitrary hues with exact official anchors or explicitly derived color-mix surface/border/hover states. Positive/active uses cyan, negative/error uses pink, warnings use orange; status words and return signs preserve non-color meaning. Korean uses Noto Sans KR because the Latin brand fonts do not provide Hangul.

Verified: production build passed; Playwright at 1488/1180/768/390/320px reports no horizontal overflow or page JavaScript errors. FontFaceSet confirms Britti Sans loads, computed heading/action families match the official roles, and computed canvas is exactly rgb(14, 9, 28). Chromium platform-font inspection confirms the custom headline font renders Latin glyphs, Korean uses Noto Sans KR and return figures use Roboto Mono. Mobile detail navigation and 320px detail overflow checks passed. Screenshots show readable captions and no clipped actions. This is a typography/color-only change; existing transaction logic is unchanged.

No outstanding P0/P1/P2. Earlier palette/font statements above describe the previous release and are superseded by this section. Font source is documented in `public/fonts/README.md`.

Brand correction deployment: code `37f7e32`, Vercel READY at https://mm-zkquant-2sonkfucm-cosmoserys-projects.vercel.app, aliased to https://mm-zkquant.vercel.app. Post-deploy Playwright checked 1488px/320px, actual font loading, computed families/canvas, mobile detail navigation and no overflow/page errors. Font response is 200 `font/woff2`. The first test sampled font readiness before render-triggered loading; explicitly awaited FontFaceSet.load, then confirmed loaded status and passing checks. Production mobile capture inspected.

## 2026-10-06 — home and full-detail navigation

final result: passed

User finding: before this change, logged-out `/` and `/strategies` rendered the same exploration component. On desktop, clicking a strategy changed the inspector; its only full-detail link was small and easy to miss. Severity: P1 navigation clarity.

The guest home now has a compact start view: what can be compared, the three investment steps, and four recent strategies from the live catalog. The full list and filters remain on `/strategies`. Logged-in `/` continues to use its existing personal dashboard. The selected strategy's inspector now has a full-width **전략 상세보기** action immediately after operating conditions, leading to `/strategies/:slug` and its full performance/history and investment detail. Mobile rows already open that route directly.

Visual source: `docs/design/images/split-reference.png` (1488 × 1056 px, density 1), selected by the user for the strategy workspace. Rendered evidence: `inspector-detail-button.png` (1488 × 1056 CSS px/pixels, density 1); full-view native-resolution pairing `inspector-detail-comparison.png` (2976 × 1056). The source and implementation were opened and compared together. The new full-width detail action is an intentional requested addition to the reference. Home has no supplied mockup; its new `home-distinct-desktop.png` (1488 × 1056) and `home-distinct-mobile-320.png` (320 × 844 viewport, full-page image) were inspected against the established dark typography/color/layout system. `home-explore-comparison.png` shows home beside exploration at their actual desktop state. Both use live data; values can differ between captures.

P2 iteration: the first 320px home capture had excessively narrow recent-strategy names. Reduced fixed return column and gaps, recaptured the loaded state; the final mobile evidence shows readable names, returns and links with no document overflow. The first mobile capture showed a temporary loading state and was rejected as final evidence.

Fonts and palette remain official Monad Britti Sans/Inter/Roboto Mono roles and purple/lavender/ink anchors. Headline wraps at 320px; helper copy and numbers remain readable. No new image assets required. The home uses live registered strategies and states no invented performance. The TEE/testnet and pending-funds explanations remain visible.

Validation: `npm run build` passed. Playwright checked home → full catalog → selected desktop inspector → detail route, and loaded 390px/320px home with zero overflow and JavaScript errors. The browser integration flow passed for public comparison, manager and investor login, private portfolio, investment confirmation, route reload, account switching and mobile layout without submitting a transaction.

Deployment check for this iteration: code `f8f19a0` is READY on Vercel at https://mm-zkquant-aai2e0557-cosmoserys-projects.vercel.app, aliased to https://mm-zkquant.vercel.app. Post-deploy Playwright confirmed distinct guest home, home-to-catalog navigation, desktop inspector-to-full-detail navigation and loaded 390px/320px home screens with no horizontal overflow or page JavaScript errors.

## 2026-10-06 — compact mobile search filters

final result: passed

User finding (P2): three visible filter selects occupied three rows beneath mobile search, delaying the strategy list. Source truth for this scoped change is the prior browser capture `docs/design/images/brand-mobile.png` at a 320 × 844 CSS px viewport, device scale 1. The selected split-workspace reference remains the broader art direction.

Implementation captures: `docs/design/images/filters-closed-320.png`, `filters-open-320.png`, `filters-closed-390.png`, `filters-open-390.png`. The 320px images were captured at 320 × 844 CSS px/density 1; 390px images at 390 × 844/density 1. `filter-compact-comparison.png` combines the first 844px of the before, new default, and new expanded state without scaling (960 × 844). The combined image and source/implementation captures were opened for comparison. Financial values changed slightly across live captures; layout is compared at the same catalog state.

Fix: at 850px and below, search and an outlined filter action share one row. Risk, status and sort remain hidden until requested. The action reports how many non-default options are applied when collapsed; selections persist across closing/reopening. At 640px and below, the expanded options use two columns and a full-width sort selector. Desktop keeps all selects visible. Search, selection, filtering and comparison remain independent.

Post-fix evidence: first strategy appears about 99px higher at 320px, the search action stays within 320px, and the expanded state retains readable 42px controls. No actionable P0/P1/P2 remains. Brand typography, colors, icons and live content are unchanged. No new raster asset is needed.

Validation: `npm run build` passed. Playwright at 320/390/768/1488px checked default visibility, `aria-expanded`, reveal, selection, collapse, applied-count display, persistence, desktop visibility, no horizontal overflow and no JavaScript errors. Existing public/manager/investor browser flows, including mobile filters, comparison and private-portfolio relay, passed without submitting transactions.

Production verification: code `272a496` is Vercel READY at https://mm-zkquant-rhmc829t0-cosmoserys-projects.vercel.app, aliased to https://mm-zkquant.vercel.app. Post-deploy Playwright repeated default collapsed state, expansion, risk/sort selection, retained applied count and zero overflow at 320/390/768/1488px. No page JavaScript errors.
