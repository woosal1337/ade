# 0008: Dot-matrix logos for harnesses and models

Date: 2026-10-12

Status: Accepted for version 0.1.0.

## Context

The site and the README named the harnesses as plain text. Ege asked for their logos, and for the logos of the main model families, in the style of the dot-matrix ade logo.

## Decision

1. The logo path data comes from Simple Icons 16.35.0 (CC0) when it has the logo, and from LobeHub Icons 1.95.1 (MIT) for the rest. `site/app/brands.ts` holds the data, the source, the version, and the license of each logo.
2. `site/app/raster.ts` turns SVG path data into a dot grid. It reads all path commands, follows the fill rule, and samples 16 points in each cell. A cell with at least 45% coverage is lit.
3. Each logo is a 22 by 22 dot grid, the same dot style as the header logo. One SVG pattern draws the dots. The lit area is a list of merged row runs.
4. The harness strip and a new models grid show the dot logos. The harness table and the model setting table show the same paths as small vector icons.
5. `tools/build-logo.mjs` writes the README logo strips for the dark and the light GitHub theme.
6. The footer, the README, and `THIRD_PARTY.md` say that the names and logos belong to their owners.

## Alternatives

- Show the original color logos. The site is monotone, and color logos would compete with the content.
- Draw the dots at run time in the browser with a canvas. The page then needs JavaScript to show a logo, and the README cannot use the same output.
- Add an SVG path library. The renderer needs about 400 lines, and a dependency would add more code than it saves.

## Consequences

- The dot style changes the look of each logo. Some brand guidelines do not permit that. Ege decides before the site becomes public.
- A logo change needs a new copy of its path data, then `node tools/build-logo.mjs`.
- The pattern method keeps the page HTML at 261 KB. Separate squares for each dot made it 856 KB.
