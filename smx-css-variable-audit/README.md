# SMX CSS audit (bookmarklet)

This repo holds a self-contained browser script that audits **SMX design-token CSS variables** (`--smx-*`) on whatever page you run it on—useful for apps that load web components from a CDN.

It does two things: **fallback audit** (finds `var(--smx-…)` in readable CSS—stylesheets, `<style>`, inline styles, `adoptedStyleSheets`, shadow roots, and same-origin iframes—and compares fallbacks to the canonical map in `EXPECTED`) and **non-themed audit** (on the properties listed in `THEMEABLE_PROPERTIES`, flags literal colors or font stacks that do not use an SMX `var(--smx-…)`). Results appear in the **devtools console**, a **floating panel** (filters, search, grouped rows), and optional **CSV export** of whatever is currently filtered in the panel. Outline highlights on elements are most meaningful where the scanner attaches to **inline** styles; cross-origin stylesheets and iframes are not readable due to browser security.

## How to run

**Option A — Bookmarklet**

1. Open [smx-css-audit.js](smx-css-audit.js) and copy the **entire** file contents (from the opening `/**` comment through the final `})();`).
2. Create a new bookmark. Set the URL to `javascript:` immediately followed by that pasted code **with no line break** after the colon (some browsers want the whole thing on one line; you can minify if needed).
3. Open your app (for example the page where your CDN-hosted components are running), then click the bookmark once.

**Bookmarklet limits:** Many browsers cap bookmark URL length. If saving the bookmark fails or it truncates, use Option B.

**Option B — Chrome DevTools Snippets (no URL length limit)**

1. Open DevTools → **Sources** → **Snippets** → **New snippet**.
2. Paste the full contents of [smx-css-audit.js](smx-css-audit.js).
3. Run the snippet (Ctrl/Cmd + Enter) while your target tab is active.

## Example

Load your staging or production app in the browser, run the bookmark or snippet once, then use the panel to filter issues and **Download CSV** for sharing with the team.

## Customizing

Edit the `EXPECTED` object at the top of [smx-css-audit.js](smx-css-audit.js) so each `--smx-*` token maps to the fallback string your design system should use. Optionally adjust `THEMEABLE_PROPERTIES` to change which CSS properties participate in the non-themed literal check.
