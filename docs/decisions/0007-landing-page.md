# 0007: The landing page

Date: 2026-10-12

Status: Accepted for version 0.1.0.

## Context

ade needs a public page that shows what it is, how to install it, and how to use it. The index project at index.chele.bi holds a catalog of 1,554 design resources and a tested Next.js stack.

## Decision

1. The page lives in `site/`, a separate npm package with its own lockfile. The CLI package does not depend on it.
2. The stack follows index: a Next.js static export, React, Tailwind CSS 4, `motion`, and the self-hosted Instrument Sans and IBM Plex Mono fonts under the SIL Open Font License.
3. The site uses Next.js 16.4.0, the current stable line. Index uses Next.js 15.
4. The site uses TypeScript 6.0.3. Next.js type checks call the TypeScript API, and TypeScript 7 has no stable API.
5. The design follows Prime Intellect, a tier A entry of the index catalog: a dark, monospace-first, terminal style. The page copies its numbered navigation tabs, its framed panels with `FIG` labels, its white mono buttons, its animated dot matrix, and its dot-matrix footer word.
6. The logo is the dot-matrix word "ade." from the footer. `site/app/glyphs.ts` holds the glyphs. The header, the footer, the favicon, and the README logo use it. Run `node tools/build-logo.mjs` after a glyph change.
7. Each command and each output line on the page comes from the real CLI.
8. The page is static. It has no analytics and no server code.
9. Fig. 1 shows the capture, share, import, plan, and apply loop on a canvas dot grid. A green comet moves from one numbered station to the next. At each arrival, the station lights, a wave crosses the grid, and the center number changes. `site/app/loop-scene.ts` draws one frame as a pure function of time. One frame takes about 1.6 ms at desktop size, and the page draws at most 45 frames each second. The animation stops when the figure is off screen, and a still frame replaces it for reduced motion.
10. Labels, buttons, tabs, table headers, and figure labels use capitalized words, for example "Get started" and "Fig. 1". The page does not set text in all capitals. Ege asked for this rule, and `test/site.test.ts` checks it.
11. Each Copy button copies its command with the Clipboard API in a secure context. On plain HTTP, such as the Tailscale preview, it copies through a selected text field. The label shows a check mark and "Copied!" for 1 second, then "Copy" again. Reduced motion turns off the slide.
12. The site builds its social images from one card component: `/og.png` at 1200 by 630 for Open Graph and X, and `/social-preview.png` at 1280 by 640 for the GitHub social preview. Each route has a `.png` name, so a static host serves it as `image/png`. `metadataBase` is `https://ade.chele.bi`, so each image URL is absolute.

## Alternatives

- One HTML file with no build. It needs no dependencies, but it does not reuse the index components and fonts.
- A documentation framework such as Fumadocs. The docs stay in Markdown on GitHub, so a docs site adds a second copy.
- brainless or termcn as the design reference. Both are component sets for terminal interfaces, not page designs.

## Consequences

- The quality gates run the site build. A commit takes about 3 seconds more.
- CI installs the site dependencies in the `checks` job.
- [Decision 0010](0010-site-hosting.md) gives the host and the domain: Vercel at `ade.chele.bi`.
