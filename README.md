# SMX CSS audit (bookmarklet)

This repo holds a self-contained browser script that audits **SMX design-token CSS variables** (`--smx-*`) on whatever page you run it on—useful for apps that load web components from a CDN.

It does two things: **fallback audit** (finds `var(--smx-…)` in readable CSS—stylesheets, `<style>`, inline styles, `adoptedStyleSheets`, shadow roots, and same-origin iframes—and compares fallbacks to the canonical map in `EXPECTED`) and **non-themed audit** (on the properties listed in `THEMEABLE_PROPERTIES`, flags literal colors or font stacks that do not use an SMX `var(--smx-…)`). Results appear in the **devtools console**, a **floating panel** (filters, search, grouped rows), and optional **CSV export** of whatever is currently filtered in the panel. Outline highlights on elements are most meaningful where the scanner attaches to **inline** styles; cross-origin stylesheets and iframes are not readable due to browser security.

## How to run

### Option A — Chrome/Edge DevTools Snippets (recommended)

This is the most reliable way to run the audit (no URL length limits).

1. Open the page you want to audit.
2. Open DevTools (Mac: Cmd+Option+I, Win/Linux: Ctrl+Shift+I).
3. Go to **Sources** → **Snippets**.
4. Click **New snippet** and name it `smx-css-audit`.
5. Open [smx-css-audit.js](smx-css-audit.js) in this repo and copy the **entire** file (from the first `/**` through the final `})();`).
6. Paste into the snippet editor.
7. Run the snippet (click **▶ Run** or press Cmd+Enter / Ctrl+Enter).

You should see results in the DevTools console and a floating **SMX CSS Audit** panel on the page.

### Option B — DevTools Console (quick one-off)

1. Open the page you want to audit.
2. Open DevTools → **Console**.
3. Paste the full contents of [smx-css-audit.js](smx-css-audit.js).
4. Press Enter.

If console pasting is flaky (large scripts sometimes are), use the **Snippets** method instead.

## Example

Load your staging or production app in the browser, run the bookmark or snippet once, then use the panel to filter issues and **Download CSV** for sharing with the team.

## Third-party CSS / libraries

The audit scans **any CSS the browser lets it read** (same-origin stylesheets, `<style>` tags, inline styles, `adoptedStyleSheets`, shadow roots, and same-origin iframes). It does **not** try to exclude third-party libraries by default.

Reporting is intentionally scoped:
- **Fallback audit** only records `var(--smx-*, …)` usages (ignores other custom properties).
- **Non-themed audit** flags literal colors / `font-family` values on a small set of themeable properties when they don’t reference an SMX token (so library CSS can appear here if it sets those properties).

Note: **cross-origin stylesheets/iframes aren’t readable** due to browser security, so results may not include CDN-hosted CSS.

## Customizing

Edit the `EXPECTED` object at the top of [smx-css-audit.js](smx-css-audit.js) so each `--smx-*` token maps to the fallback string your design system should use. Optionally adjust `THEMEABLE_PROPERTIES` to change which CSS properties participate in the non-themed literal check.
