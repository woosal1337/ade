# 0010: Host the site on Vercel at ade.chele.bi

Date: 2026-10-12

Status: Accepted for version 0.1.0.

## Context

The landing page in `site/` is a static export. [Decision 0007](0007-landing-page.md) left the host and the domain open. Ege made the repository public on 2026-10-12 and asked for the site at `ade.chele.bi`. Cloudflare holds the DNS of `chele.bi`, and other `chele.bi` sites run on Vercel.

## Decision

1. The Vercel project `ade` builds the `site` folder with Node.js 24.
2. The Vercel Git integration deploys each push to `main` to production.
3. Cloudflare holds a `CNAME` record from `ade.chele.bi` to the Vercel DNS target of the project. The record is DNS only, so Vercel issues the TLS certificate.
4. The site metadata uses `https://ade.chele.bi` as the base URL. The Open Graph image, the X image, and the canonical URL use that base.
5. The GitHub repository uses `https://ade.chele.bi` as its homepage.

## Alternatives

- GitHub Pages. It serves static files well, but each deploy needs a workflow with write permissions for Pages.
- A host in the home lab behind Cloudflare Tunnel. It adds a server to maintain for a static page.

## Consequences

- A push to `main` changes the public site. The CI checks run in parallel and do not block the deploy.
- Vercel builds pull request previews. A preview from a fork needs approval in Vercel first.
- Vercel login protects the `vercel.app` addresses of each deployment. Only `ade.chele.bi` is public.
- The GitHub social preview has no API. A person uploads `https://ade.chele.bi/social-preview.png` in the repository settings.
