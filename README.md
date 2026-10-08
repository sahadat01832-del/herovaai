# HerovaAi — public site

The indexable public face of HerovaAi: a landing page, the Privacy Policy and the Terms of Service.
Served by GitHub Pages at **https://sahadat01832-del.github.io/herovaai/**.

## Why it exists

The app itself is self-hosted behind a Cloudflare quick tunnel. Cloudflare answers every response from a
`*.trycloudflare.com` host with `x-robots-tag: none`, which tells Google, Bing and DuckDuckGo not to index it,
and the tunnel hostname is regenerated whenever the tunnel restarts. So the pages that *should* be findable
live here, on a stable address, while the app keeps running where it runs.

## The app link

Every page links to the running app through its current tunnel URL. When the tunnel restarts and its
hostname changes, `scripts/sync-app-url.sh` in the HerovaAi repository rewrites those links and pushes the
change, so the published buttons never rot.

## Keeping it in sync

The policy text here mirrors the app's own `/privacy` and `/terms` pages (`frontend/src/app/(marketing)/`).
Change them together — the app is the source of truth, this is the mirror search engines can reach.

## Local preview

```bash
python3 -m http.server 8090   # then open http://localhost:8090/
```
