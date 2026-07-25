# Eden Student and Migration Service — Website

A modern, mobile-first, SEO-optimized static rebuild of
[eden-studentservice.com](https://eden-studentservice.com/) — no WordPress,
no build step, no dependencies. Just HTML, CSS, and a few lines of JS.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Home — hero, services overview, 5-step process, destinations |
| `services.html` | Full service details incl. student visa pricing |
| `contact.html` | Contact channels + Sydney & Brisbane offices |
| `404.html` | Not-found page |
| `sitemap.xml`, `robots.txt` | SEO |
| `CNAME` | Custom domain for GitHub Pages |

## Turning on free hosting (GitHub Pages)

1. On GitHub, open this repository → **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**, then pick
   **`main`** and **`/ (root)`**, and click **Save**.
3. After a minute or two the site is live at
   `https://andrekorte.github.io/Eden-Website/` (the address is
   case-sensitive — capital E and W, matching the repository name).

## Using the real domain (eden-studentservice.com)

1. In **Settings → Pages → Custom domain**, enter
   `eden-studentservice.com` and save. (The `CNAME` file in this repo
   holds the same value.)
2. At your domain registrar (where the domain is currently managed),
   change the DNS records to point at GitHub Pages:
   - `A` records for the bare domain: `185.199.108.153`,
     `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` record for `www` → `andrekorte.github.io`
3. Back in **Settings → Pages**, tick **Enforce HTTPS** once the
   certificate has been issued (can take up to a day).

⚠️ Switching the DNS takes the old WordPress site offline — do this only
once you're happy with the new site.

## Editing content

- All text lives directly in the three HTML pages — edit and commit.
- Colors, fonts, and spacing are CSS custom properties at the top of
  `assets/css/style.css`.
- To add photos, drop them in `assets/img/` and reference them with
  `<img src="assets/img/..." alt="..." loading="lazy">`.

## Things to verify before going live

- **Sydney office address**: sources differ between Shop T02 and T03 at
  Capital Square — currently set to T02, please confirm.
- **Phone numbers / opening hours** on `contact.html`.
- **Service pricing** (currently 12,990 THB for the student visa service).
