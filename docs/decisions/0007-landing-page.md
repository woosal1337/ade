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
5. The design follows Prime Intellect, a tier A entry of the index catalog: a dark, monospace-first, terminal style. The page copies its numbered navigation tabs, its framed panels with `FIG` labels, its command loop diagram, its white mono buttons, its animated dot matrix, and its dot-matrix footer word.
6. Each command and each output line on the page comes from the real CLI.
7. The page is static. It has no analytics and no server code.

## Alternatives

- One HTML file with no build. It needs no dependencies, but it does not reuse the index components and fonts.
- A documentation framework such as Fumadocs. The docs stay in Markdown on GitHub, so a docs site adds a second copy.
- brainless or termcn as the design reference. Both are component sets for terminal interfaces, not page designs.

## Consequences

- The quality gates run the site build. A commit takes about 3 seconds more.
- CI installs the site dependencies in the `checks` job.
- A deploy needs a host and a domain. Ege decides both.
