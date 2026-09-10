# Hero reference audit

## Scope and implementation

- Rebuilt the hero around `hero-target.png`: central logo hexagon, pastel satellite cells, raised ivory shelf, pink and blue bags, shoes and accessories.
- Recreated only the cream/pastel background of `hero-reference-hive-products.jpeg` in CSS. No children or baked-in screenshot text.
- Used supplied merchandise assets. The blue shoe source had a dark background; a derived white-background version uses a CSS silhouette clip to preserve the white soles without beige multiply tinting. Original assets remain unchanged.
- Added coordinated 5px CSS product float with staggered 6–7 second cycles under prefers-reduced-motion: no-preference, keeping the logo and shelf stationary. Kept subtle button feedback with reduced-motion support, semantic links, visible keyboard focus and responsive Next Image delivery.
- Fixed deleted logo references in the mobile menu and footer. Updated available category art and used a neutral gift icon where toy art no longer exists.

## Verification

- Arabic desktop and Arabic/English mobile visually reviewed.
- No horizontal overflow at 320px; all six hero images loaded at 390px.
- Mobile browser selected 128px optimized image variants rather than original full-size assets.
- Collection link reached the existing collection anchor.
- TypeScript passed. Production build and ESLint results recorded in the task.

## Existing limitation

The local catalog and reviews display their load-error states. This pass does not establish live API or production functionality. A separate development API check is still needed before claiming an end-to-end storefront audit.

## Derived asset provenance

Saved asset: `apps/web/public/brand/merch/boy-shoes-white.png`.

Mode: built-in ImageGen, background edit. Two transparent-background attempts returned painted checkerboards and were rejected. The final asset uses a CSS silhouette clip; it is not described as an alpha cutout.

Final prompt:

> Edit background only. Place this EXACT pair of blue children's sneakers on a completely pure flat WHITE (#FFFFFF) background. No checkerboard, no gray, no gradients, no glow, no shadow, no floor texture. Pure white everywhere outside the exact shoe outlines. Preserve shoes, colors, positions and details. Entire pair in frame. Standard clean e-commerce product cutout on white.

## Accessory and mobile refinement

- Replaced the crowded accessory collage with four distinct pieces: a bow clip, flower barrette, bracelet and heart necklace, in pink and turquoise.
- Asset: `apps/web/public/brand/merch/kids-accessories-v2.png`, generated with built-in ImageGen. Decorative campaign artwork, not an assertion of available stock.
- Mobile now shows the merchandise display above the copy, with a short category caption. Desktop composition is unchanged.
- Reviewed at 390px: full shelf visible above the heading, no horizontal overflow.

Final generation prompt:

> Create a clean premium e-commerce product photograph of exactly FOUR children's fashion accessories, arranged as a compact readable group for a website hero shelf: one large dusty-pink grosgrain bow hair clip on the left standing at a gentle angle; one small pastel turquoise flower barrette in front of it; one chunky pink and turquoise round-bead bracelet on the right; one short pastel bead necklace forming an upright oval behind the bracelet with a simple pink heart pendant hanging visibly in its center. All four items must be distinct, not tangled, not a dense pile. Simple bold recognizable silhouettes legible when displayed only 140 pixels wide. Front three-quarter camera view slightly above, items resting at same baseline. Photoreal fabric and smooth beads, tasteful children's boutique styling, restrained pink, pale turquoise, warm cream, tiny muted gold findings. Entire group fills central 90 percent of a landscape 3:2 image with a narrow margin, no crops. Pure flat WHITE #FFFFFF background everywhere outside objects, no background gradients, no checkerboard, no floor line, no text, no logo, no person, no packaging, no extra items, no glitter. Soft studio illumination and minimal contact shadow.
