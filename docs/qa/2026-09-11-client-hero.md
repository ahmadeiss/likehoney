# Client hero — September 11, 2026

Only the home hero was rebuilt. Desktop composition follows the supplied client reference: bee at left, centered live bilingual text, bunny backpack and shoes on the right, peach platform, hair bows, flower sunglasses, cream background and scalloped edges. Mobile places the illustrated display above the live copy. Existing header, categories and other sections are outside this change.

The artwork is newly generated campaign illustration, not catalog stock photography. Reference matching is a recreation, not a pixel-identical copy of the supplied screenshot.

Asset: `apps/web/public/media/campaign/client-hero-v3.png` (2172 × 724).
Mode: built-in ImageGen with the user-supplied screenshot as a composition reference. No previous merchandise assets reused.

## Final prompt

Recreate ONLY the wide hero banner artwork from this website reference, NOT the header, navigation, logo wordmark, category circles, product cards or footer. Produce a wide landscape 3:1 banner. Match the hero composition precisely: warm pale cream background; left third has a large cute illustrated smiling golden queen bee mascot with crown, large pale aqua wings, pink antenna tips and small pink feet, floating facing slightly right, like the reference. Right third has a large blush pink bunny-face children's backpack standing on a peach low oval display platform, a pair of pink velcro children's sneakers in front left of the bag, one mint turquoise star sneaker on right, and pink bow hair accessories and lavender flower-shaped sunglasses along the front of the platform. Match the soft realistic 3D merchandise textures of the reference. CENTER THIRD from 36% to 62% width must be completely blank cream negative space for HTML headline and button, do NOT draw any text there. Around outer edges reproduce small pastel flowers, teal foliage, clouds, tiny golden honeycomb hexagon motifs, doodled hearts, small flying bee upper right and looping thin dashed bee trails. Pastel blush pink, mint aqua, buttery yellow, peach and warm cocoa outlines. Flat cream center, not yellow gradients. White scalloped boundary along very top and gently curved white boundary along bottom. NO TEXT ANYWHERE, NO LETTERS, NO BUTTONS, NO UI, no honey jars, no children or humans. Preserve the relative placement and scale of the bee at left and merchandise at right from the reference. This is final hero artwork not a full website screenshot.

## Checks

Desktop and 390px mobile reviewed visually. Live heading, accessible shop link and reduced-motion button feedback retained. Next Image delivers responsive optimized artwork. TypeScript and ESLint passed.

## Mobile seam fix

Replaced two independently scaled/cropped desktop images with a single mobile composition selected by a native picture/source element. The previous 130vw/155vw crop combination caused a visible internal seam and the baked white bottom edge broke continuity with the cream copy area. Mobile now has a reserved 3:2 ratio and a cream gradient transition; desktop keeps the approved artwork.

Static WebP assets avoid reliance on differing runtime image optimization implementations in Next and Vinext/Cloudflare:

- `apps/web/public/media/campaign/client-hero-mobile-v4.webp`: 1536 × 1024, 131230 bytes.
- `apps/web/public/media/campaign/client-hero-desktop-v4.webp`: 2172 × 724, 100316 bytes.

Mobile composition produced by built-in ImageGen; WebP encoding by local Sharp. Preview verified at 390px (one image, mobile currentSrc, no overflow). This is browser viewport testing, not physical iPhone Safari testing. Deployment is not performed by this task.

Final image-edit prompt:

> Adapt this exact hero artwork into ONE seamless landscape 3:2 mobile composition. Keep the same friendly crowned bee mascot fully visible on the left occupying 35 percent, and the same pink bunny backpack, pink shoes, mint shoe, bows and lavender sunglasses on the peach platform grouped on the right occupying 65 percent. Bring them together with no big blank central gap. Same cream background and pastel flowers, leaves and bee trails. No text. No dividing line, no split panels, no collage seam. Keep all main subjects completely in frame. White scalloped top edge like original. At the bottom, gently fade the scene into a uniform solid pale cream #fff7eb over the bottom 12 percent of the image, with NO white wave or white strip at the bottom; final bottom edge must be plain #fff7eb, so a cream HTML text area can continue below seamlessly. Keep faithful style and character identity, natural proportions, no stretching.
