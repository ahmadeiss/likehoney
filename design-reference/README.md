# Reference Assets

Reference material for the Like Honey visual identity.

| Folder      | Purpose                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `brand/`    | Brand assets that may eventually be used by the application (logo, mascot, honey/bee graphics). Classified originals; do not edit. |
| `concepts/` | Visual concept / mood / UI reference images. Not production assets.                                                                |

Source files under `_incoming-assets/` — if present — are never modified; assets
are classified and moved here only when categorization is unambiguous.
See `docs/design/DESIGN_DIRECTION.md` for how assets relate to design work.

`brand/store/` holds the raw, unprocessed real-store footage as supplied
(currently a phone screen-recording of an Instagram Reel, Instagram UI chrome
and all — not web-servable as-is). The cropped/graded/loop-encoded derivative
actually used by the home page lives at
`apps/web/public/media/store/entrance.mp4` (+ `entrance-poster.jpg` /
`entrance-backdrop.jpg`). If better raw footage becomes available, replace the
file here and re-run the crop/grade/loop pipeline before dropping a new
`entrance.mp4` into `apps/web/public/media/store/`.

> **Brand positioning:** Like Honey is a premium **children's retail store**
> (clothing, shoes, bags, toys, accessories, baby products, gifts). The
> bee/honey assets are **brand language** — decoration and storytelling. They
> are never storefront merchandise, and no honey/food product is sold.
