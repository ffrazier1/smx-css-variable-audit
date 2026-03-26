/**
 * SMX CSS variable audit — bookmarklet source
 *
 * What it does:
 * - Fallback audit: finds `var(--smx-*, …)` in readable CSS (stylesheets, <style>, inline styles,
 *   adoptedStyleSheets, shadow roots, same-origin iframes). Compares fallbacks to `EXPECTED`.
 * - Non-themed audit: on `THEMEABLE_PROPERTIES`, flags literal colors / font stacks that do not use
 *   an SMX `var(--smx-…)`.
 *
 * When to edit:
 * - `EXPECTED` — canonical fallback per token (keep in sync with your design system / CDN theme).
 * - `THEMEABLE_PROPERTIES` — expand or shrink the list of properties checked for literals.
 *
 * Limitations:
 * - Cross-origin CSS and iframes are not readable; results are best-effort for those cases.
 * - Inline outline highlights are most meaningful for inline-styled elements the scanner touches.
 * - Library bucket `vue-mat-lib` is a heuristic: "mdc" in selector / snippet / source / class / tag.
 *
 * Usage: see README.md (bookmark bar or Chrome DevTools snippet).
 */

(function () {

  // --- Configuration: canonical tokens, themeable properties, UI colors, panel/highlight IDs ---
  const EXPECTED = {
    '--smx-color-test':              '#c51c1c',
    '--smx-color-primary':           '#006B5B',
    '--smx-color-secondary':         '#436278',
    '--smx-color-tertiary':          '#006B5B',
    '--smx-color-high-emphasis':     'rgba(0, 0, 0, 0.87)',
    '--smx-color-medium-emphasis':   'rgba(0, 0, 0, 0.6)',
    '--smx-color-disabled':          'rgba(0, 0, 0, 0.38)',
    '--smx-color-button-disabled':   'rgba(0, 0, 0, 0.12)',
    '--smx-color-on-primary':        '#FFFFFF',
    '--smx-color-background':        '#FFFFFF',
    '--smx-color-surface':           '#FFFFFF',
    '--smx-color-success':           '#006B5B',
    '--smx-color-error':             '#BA1A1A',
    '--smx-color-warning':           '#BC5D00',
    '--smx-color-info':              '#436278',
    '--smx-color-neutral':           '#f5f5f5',
    '--smx-color-neutral-variant':   '#E5F0EF',
    '--smx-color-scrim':             'rgba(0, 0, 0, 0.21)',
    '--smx-color-track-default':     '#E0E0E0',
    '--smx-color-track-active':      '#CCE1DE',
    '--smx-color-divider':           '#E0E0E0',
    '--smx-color-tooltips':          '#666666',
    '--smx-font-family':             "'roboto', sans-serif",
  };

  const THEMEABLE_PROPERTIES = new Set([
    'color',
    'background',
    'background-color',
    'border',
    'border-color',
    'border-top',
    'border-top-color',
    'border-right',
    'border-right-color',
    'border-bottom',
    'border-bottom-color',
    'border-left',
    'border-left-color',
    'outline',
    'outline-color',
    'box-shadow',
    'text-shadow',
    'fill',
    'stroke',
    'caret-color',
    'column-rule',
    'column-rule-color',
    'font-family',
  ]);

  const HIGHLIGHT_CLASS = '__smx_var_highlight__';
  const PANEL_ID = '__smx_var_panel__';

  const UI = {
    panelBg: '#111827',
    panelBorder: '#c084fc',
    panelText: '#f3f4f6',
    panelMuted: '#cbd5e1',
    panelSubtle: '#94a3b8',
    panelFaint: '#64748b',
    headerBg: '#0b1020',
    sectionBg: '#0f172a',
    codeBg: '#020617',

    ok: '#22c55e',
    okBg: '#052e16',
    wrong: '#f59e0b',
    wrongBg: '#3b2500',
    missing: '#f43f5e',
    missingBg: '#3a0d18',
    unknown: '#60a5fa',
    unknownBg: '#0c274a',
    notFound: '#94a3b8',
    notFoundBg: '#1f2937',
    nonThemed: '#fb7185',
    nonThemedBg: '#3b0a1a',

    accent: '#d946ef',
    accentSoft: '#d946ef33',
    library: '#5eead4',
  };

  document.getElementById(PANEL_ID)?.remove();
  document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(el => {
    el.style.outline = el.dataset.prevOutline ?? '';
    delete el.dataset.prevOutline;
    el.classList.remove(HIGHLIGHT_CLASS);
  });

  // --- CSS string parsing: balanced parentheses, `var()` arguments, comments, declaration splitting ---

  /**
   * Index of the `)` that closes the `(` at `openIndex`, respecting nesting.
   * @param {string} str
   * @param {number} openIndex index of '('
   * @returns {number} closing index, or -1
   */
  function findMatchingParen(str, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < str.length; i++) {
      const ch = str[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function stripCssComments(s) {
    return String(s || '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  }

  function shorten(text, max = 180) {
    const s = String(text || '');
    if (s.length <= max) return s;
    return s.slice(0, max) + '…';
  }

  /**
   * Split `var(--a, fallback)` inner text on commas only at nesting depth 0
   * (so commas inside `rgb()` / nested `var()` stay intact).
   */
  function splitTopLevelArgs(str) {
    const parts = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '(') {
        depth++;
        current += ch;
      } else if (ch === ')') {
        depth--;
        current += ch;
      } else if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }

    parts.push(current.trim());
    return parts;
  }

  function parseSingleVarExpression(expr) {
    const s = String(expr || '').trim();
    if (!s.startsWith('var(') || !s.endsWith(')')) return null;

    const inner = s.slice(4, -1);
    const args = splitTopLevelArgs(inner);
    const variable = (args[0] || '').trim();

    if (!variable.startsWith('--')) {
      return { variable, fallback: null, hasFallback: false };
    }

    if (args.length < 2) {
      return { variable, fallback: null, hasFallback: false };
    }

    const firstCommaIndex = inner.indexOf(',');
    const fallback = stripCssComments(inner.slice(firstCommaIndex + 1));

    return { variable, fallback, hasFallback: true };
  }

  function hasResolvableFallback(fallback) {
    const cleaned = stripCssComments(fallback);
    if (!cleaned) return false;

    if (!cleaned.startsWith('var(') || !cleaned.endsWith(')')) {
      return true;
    }

    const parsed = parseSingleVarExpression(cleaned);
    if (!parsed || !parsed.hasFallback) return false;
    return hasResolvableFallback(parsed.fallback);
  }

  function parseVarUsages(css) {
    const usages = [];
    let i = 0;

    while (i < css.length) {
      const start = css.indexOf('var(', i);
      if (start === -1) break;

      const openParen = start + 3;
      const end = findMatchingParen(css, openParen);
      if (end === -1) break;

      const text = css.slice(start, end + 1);
      const inner = css.slice(openParen + 1, end);
      const args = splitTopLevelArgs(inner);

      const variable = (args[0] || '').trim();
      const hasComma = args.length > 1;
      const rawFallback = hasComma ? inner.slice(inner.indexOf(',') + 1) : null;
      const fallback = hasComma ? stripCssComments(rawFallback) : null;

      usages.push({
        variable,
        fallback,
        rawFallback,
        hasComma,
        index: start,
        text,
      });

      i = end + 1;
    }

    // We only care about SMX tokens; ignore all other `var(--*)` usages.
    // (This keeps the audit focused and prevents noisy results from unrelated custom props.)
    return usages.filter(u => /^--smx-[\w-]+$/.test(u.variable));
  }

  function parseDeclarations(css) {
    return String(css || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const idx = part.indexOf(':');
        if (idx === -1) return null;
        return {
          property: part.slice(0, idx).trim(),
          value: part.slice(idx + 1).trim(),
        };
      })
      .filter(Boolean);
  }

  function normalise(s) {
    return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function splitFontFamilyList(value) {
    const parts = [];
    let current = '';
    let quote = null;

    for (let i = 0; i < value.length; i++) {
      const ch = value[i];

      if (ch === '"' || ch === "'") {
        if (!quote) quote = ch;
        else if (quote === ch) quote = null;
        current += ch;
        continue;
      }

      if (ch === ',' && !quote) {
        parts.push(current.trim());
        current = '';
        continue;
      }

      current += ch;
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function normaliseFontFamily(value) {
    return splitFontFamilyList(String(value))
      .map(part => {
        const trimmed = part.trim();
        const unquoted =
          (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))
            ? trimmed.slice(1, -1)
            : trimmed;

        return unquoted.replace(/\s+/g, ' ').trim().toLowerCase();
      })
      .join(', ');
  }

  function fallbacksEquivalent(variable, fallback, expected) {
    if (variable === '--smx-font-family') {
      return normaliseFontFamily(fallback) === normaliseFontFamily(expected);
    }
    return normalise(fallback) === normalise(expected);
  }

  /**
   * Classify a single `--smx-*` var() usage against `EXPECTED`.
   *
   * Status semantics:
   * - ok: fallback exists and matches EXPECTED (with font-family normalization special-cased)
   * - wrong: fallback exists but differs from EXPECTED
   * - missing-fallback: no comma fallback OR fallback is empty OR only resolves to empty nested var()
   * - unknown-var: token not present in EXPECTED (usually a new token or typo)
   * @returns {{ status: 'ok'|'wrong'|'missing-fallback'|'unknown-var', expected: string|null }}
   */
  function classify(variable, fallback, hasComma) {
    const expected = EXPECTED[variable];
    if (!expected) return { status: 'unknown-var', expected: null };

    if (!hasComma) return { status: 'missing-fallback', expected };

    const cleanedFallback = stripCssComments(fallback);
    if (!cleanedFallback) return { status: 'missing-fallback', expected };
    if (!hasResolvableFallback(cleanedFallback)) return { status: 'missing-fallback', expected };

    if (fallbacksEquivalent(variable, cleanedFallback, expected)) {
      return { status: 'ok', expected };
    }

    return { status: 'wrong', expected };
  }

  function extractSnippet(css, matchIndex) {
    let start = matchIndex;
    while (start > 0 && css[start - 1] !== ';' && css[start - 1] !== '{') start--;

    let end = matchIndex;
    let depth = 0;
    while (end < css.length) {
      if (css[end] === '(') depth++;
      else if (css[end] === ')') depth--;
      else if ((css[end] === ';' || css[end] === '}') && depth === 0) {
        end++;
        break;
      }
      end++;
    }

    return css.slice(start, end).replace(/\s+/g, ' ').trim();
  }

  function isThemeableProperty(prop) {
    return THEMEABLE_PROPERTIES.has(String(prop || '').trim().toLowerCase());
  }

  function hasSmxToken(value) {
    return /var\(\s*--smx-[\w-]+/i.test(String(value || ''));
  }

  function looksLikeLiteralColor(value) {
    const v = String(value || '').trim();
    return (
      /#(?:[0-9a-f]{3,8})\b/i.test(v) ||
      /\brgba?\(/i.test(v) ||
      /\bhsla?\(/i.test(v) ||
      /\b(?:black|white|gray|grey|red|green|blue|orange|yellow|purple|pink|brown|transparent|currentcolor)\b/i.test(v)
    );
  }

  function looksLikeLiteralFontFamily(value) {
    const v = String(value || '').trim();
    if (hasSmxToken(v)) return false;
    if (!v) return false;

    return (
      /["'][^"']+["']/.test(v) ||
      /\b(?:roboto|arial|helvetica|inter|sans-serif|serif|monospace|system-ui)\b/i.test(v)
    );
  }

  function shouldFlagNonThemedDeclaration(property, value) {
    const prop = String(property || '').trim().toLowerCase();
    const val = String(value || '').trim();

    if (!isThemeableProperty(prop)) return false;
    if (!val) return false;
    if (hasSmxToken(val)) return false;

    if (prop === 'font-family') {
      return looksLikeLiteralFontFamily(val);
    }

    // Heuristic: if a themeable property contains a literal color (hex/rgb/hsl/basic keywords)
    // and does NOT reference an SMX token, it's likely bypassing theming.
    return looksLikeLiteralColor(val);
  }

  /**
   * Rough hint for triage: Material / vue-mat-lib stacks often expose "mdc" in CSS or markup.
   * Not authoritative — only used for CSV/panel "library" grouping.
   */
  function looksLikeVueMatLib({ selector, snippet, source, el }) {
    const haystack = [
      selector || '',
      snippet || '',
      source || '',
      typeof el?.className === 'string' ? el.className : '',
      el?.tagName || '',
    ].join(' ').toLowerCase();

    return haystack.includes('mdc');
  }

  /** Attach `vue-mat-lib` hint when `looksLikeVueMatLib` matches (see JSDoc above). */
  function getLibraryHint(ctx, status) {
    if (status !== 'missing-fallback' && status !== 'wrong' && status !== 'non-themed') return null;
    return looksLikeVueMatLib(ctx) ? 'vue-mat-lib' : null;
  }

  function getLibraryBucket(libraryHint) {
    return libraryHint === 'vue-mat-lib' ? 'vue-mat-lib' : 'non-vue-mat-lib';
  }

  function getSearchText(result) {
    if (result.status === 'unknown-var' && result.variable) return `var(${result.variable})`;
    if (result.selector && result.selector !== '<style>') return result.selector;
    return result.snippet || result.variable || result.property || '';
  }

  function getLocator(result) {
    const source = result.source || 'unknown-source';

    if (result.status === 'unknown-var' && result.variable) {
      return `${source} :: var(${result.variable})`;
    }

    const target =
      result.selector && result.selector !== '<style>'
        ? result.selector
        : (result.snippet || result.variable || result.property || '<unknown>');

    return shorten(`${source} :: ${target}`);
  }

  function getShadowHostFromSource(source) {
    if (!source) return null;
    const match = String(source).match(/shadow:([^\s<]+)/);
    return match ? match[1] : null;
  }

  function getVueScopeAttr(text) {
    const match = String(text || '').match(/data-v-[a-z0-9]+/i);
    return match ? match[0] : null;
  }

  function getElementLabel(el) {
    if (!el || !el.tagName) return null;

    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classList =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';

    return `${tag}${id}${classList}`;
  }

  function getExampleElements(result) {
    const out = [];
    const seen = new Set();

    if (result.el && result.el.nodeType === 1) {
      const label = getElementLabel(result.el);
      if (label && !seen.has(label)) {
        seen.add(label);
        out.push(label);
      }
    }

    if (result.selector && result.selector !== '<style>') {
      try {
        document.querySelectorAll(result.selector).forEach(el => {
          if (out.length >= 3) return;
          const label = getElementLabel(el);
          if (label && !seen.has(label)) {
            seen.add(label);
            out.push(label);
          }
        });
      } catch {}
    }

    return out;
  }

  function getMatchCount(result) {
    if (result.el && (!result.selector || result.selector === '<style>')) return 1;
    if (!result.selector || result.selector === '<style>') return null;

    try {
      return document.querySelectorAll(result.selector).length;
    } catch {
      return null;
    }
  }

  /** Add locator, search text, live match counts, Vue/shadow hints for reporting. */
  function enrichResult(result) {
    const locator = getLocator(result);
    const searchText = getSearchText(result);
    const matchCount = getMatchCount(result);
    const exampleElements = getExampleElements(result);
    const shadowHost = getShadowHostFromSource(result.source);
    const vueScopeAttr = getVueScopeAttr(
      [result.selector, result.snippet, result.source].filter(Boolean).join(' ')
    );

    return {
      ...result,
      locator,
      searchText,
      matchCount,
      exampleElements,
      shadowHost,
      vueScopeAttr,
    };
  }

  // --- Clipboard helpers ---

  function copyText(text, btn) {
    navigator.clipboard?.writeText(text).then(() => {
      if (!btn) return;
      const prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = prev; }, 900);
    }).catch(() => {});
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function buildCsv(rows) {
    return rows.map(row => row.map(csvEscape).join(',')).join('\n');
  }

  function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- Export: CSV download (uses currently filtered panel rows) ---

  function downloadCsv(rowsToExport) {
    const rows = [
      [
        'Audit Type',
        'Status',
        'Library Bucket',
        'Flag',
        'Variable',
        'Property',
        'Fallback Found',
        'Expected Fallback',
        'Locator',
        'Search Text',
        'Selector',
        'Live Matches',
        'Example Elements',
        'Vue Scope Attr',
        'Shadow Host',
        'Snippet',
        'Source'
      ],
      ...rowsToExport.map(r => [
        r.auditType ?? '',
        r.status,
        getLibraryBucket(r.libraryHint),
        r.libraryHint ?? '',
        r.variable ?? '',
        r.property ?? '',
        r.fallback ?? '',
        r.expected ?? '',
        r.locator ?? '',
        r.searchText ?? '',
        r.selector ?? '',
        r.matchCount ?? '',
        (r.exampleElements || []).join(' | '),
        r.vueScopeAttr ?? '',
        r.shadowHost ?? '',
        r.snippet ?? '',
        r.source
      ])
    ];

    const csv = buildCsv(rows);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`smx-css-audit-${timestamp}.csv`, csv, 'text/csv;charset=utf-8;');
  }

  // --- Results: dedupe, highlights, scan helpers ---

  /**
   * Normalized "row" shape used everywhere (console, panel, CSV).
   *
   * Producer fields (set during scanning):
   * - auditType: 'fallback' | 'non-themed'
   * - status: 'ok' | 'wrong' | 'missing-fallback' | 'unknown-var' | 'not-found' | 'non-themed'
   * - variable: '--smx-*' token (fallback audit only)
   * - property: CSS property name (non-themed audit only)
   * - fallback / expected: found fallback vs canonical EXPECTED (fallback audit only)
   * - selector: best-effort CSS selector or label for where we saw it
   * - snippet: short declaration-ish context used for display/search
   * - source: stylesheet URL, 'inline', or a synthetic label (e.g. shadow/iframe)
   * - el: optional Element for inline styles (enables outline highlighting)
   * - libraryHint: optional triage hint (currently `vue-mat-lib` via `mdc` heuristic)
   *
   * Enriched/reporting fields (added by `enrichResult`):
   * - locator: stable-ish human string used for triage/copying
   * - searchText: what you likely want to Ctrl+F for in sources
   * - matchCount / exampleElements: live DOM approximation (selector-based; best-effort)
   * - vueScopeAttr / shadowHost: hints for scoping / web-component boundaries
   */
  const results = [];
  const seenResultKeys = new Set();
  const collapsedGroups = new Set();

  function makeResultKey(result) {
    return [
      result.auditType || '',
      result.status || '',
      result.libraryHint || '',
      result.variable || '',
      result.property || '',
      result.fallback || '',
      result.expected || '',
      result.selector || '',
      result.snippet || '',
      result.source || '',
    ].join('||');
  }

  function pushResult(result) {
    const key = makeResultKey(result);
    if (seenResultKeys.has(key)) return;
    seenResultKeys.add(key);
    results.push(result);
  }

  function applyHighlight(el, status) {
    if (!el || el.classList.contains(HIGHLIGHT_CLASS)) return;
    el.dataset.prevOutline = el.style.outline;
    el.classList.add(HIGHLIGHT_CLASS);

    // Visual aid only: we can reliably highlight inline-styled elements we touch.
    // Stylesheet-only findings may not map to a single concrete element at scan time.
    el.style.outline =
      status === 'ok'
        ? `2px solid ${UI.ok}`
        : status === 'wrong' || status === 'unknown-var' || status === 'non-themed'
        ? '2px solid #e040fb'
        : `2px solid ${UI.missing}`;
  }

  function scanNonThemedDeclarations(css, source, el, selector) {
    parseDeclarations(css).forEach(({ property, value }) => {
      if (!shouldFlagNonThemedDeclaration(property, value)) return;

      const snippet = `${property}: ${value};`;
      const libraryHint = getLibraryHint({ selector, snippet, source, el }, 'non-themed');

      const baseResult = {
        auditType: 'non-themed',
        variable: null,
        property,
        fallback: null,
        source,
        el,
        selector,
        status: 'non-themed',
        expected: null,
        snippet,
        libraryHint,
      };

      pushResult(enrichResult(baseResult));
      applyHighlight(el, 'non-themed');
    });
  }

  // --- DOM / stylesheet traversal: rules, shadow roots, same-origin iframes ---

  function scanText(css, source, el, selector) {
    parseVarUsages(css).forEach(({ variable, fallback, hasComma, index }) => {
      const snippet = extractSnippet(css, index);
      const { status, expected } = classify(variable, fallback, hasComma);
      const libraryHint = getLibraryHint({ selector, snippet, source, el }, status);

      const baseResult = {
        auditType: 'fallback',
        variable,
        property: null,
        fallback,
        source,
        el,
        selector,
        status,
        expected,
        snippet,
        libraryHint,
      };

      pushResult(enrichResult(baseResult));
      applyHighlight(el, status);
    });

    scanNonThemedDeclarations(css, source, el, selector);
  }

  function elSelector(el) {
    const tag = el?.tagName ? el.tagName.toLowerCase() : '';
    const id = el?.id ? '#' + el.id : '';
    const cls = el?.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return tag + id + cls || '(inline)';
  }

  function processRule(rule, source, ownerEl) {
    if (!rule) return;

    if (rule.type === CSSRule.STYLE_RULE) {
      const selector = rule.selectorText ?? rule.cssText.slice(0, 120);
      const css = rule.style ? rule.style.cssText : rule.cssText;
      scanText(css, source, ownerEl, selector);
      return;
    }

    if (rule.type === CSSRule.KEYFRAMES_RULE && rule.cssRules) {
      Array.from(rule.cssRules).forEach(child => {
        const selector = `@keyframes ${rule.name} ${child.keyText || ''}`.trim();
        const css = child.style ? child.style.cssText : child.cssText;
        scanText(css, source, ownerEl, selector);
      });
      return;
    }

    if (rule.cssRules && rule.cssRules.length) {
      Array.from(rule.cssRules).forEach(child => processRule(child, source, ownerEl));
    }
  }

  function scanStyleSheet(sheet, sourceLabel, ownerEl) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      return;
    }
    if (!rules) return;

    Array.from(rules).forEach(rule => processRule(rule, sourceLabel, ownerEl));
  }

  function getRootStyleSheets(root) {
    const sheets = new Set();

    if (root.styleSheets) {
      Array.from(root.styleSheets).forEach(s => sheets.add(s));
    }

    if (root.adoptedStyleSheets) {
      Array.from(root.adoptedStyleSheets).forEach(s => sheets.add(s));
    }

    return Array.from(sheets);
  }

  function scanRoot(root, sourcePrefix) {
    if (root.querySelectorAll) {
      root.querySelectorAll('[style]').forEach(el => {
        scanText(el.getAttribute('style') || '', 'inline', el, elSelector(el));
      });

      root.querySelectorAll('style').forEach((styleEl, i) => {
        scanText(
          styleEl.textContent || '',
          `${sourcePrefix} <style#${i + 1}>`,
          styleEl,
          '<style>'
        );
      });
    }

    getRootStyleSheets(root).forEach((sheet, i) => {
      const source =
        sheet.href ||
        (sheet.ownerNode?.tagName
          ? `${sourcePrefix} <${sheet.ownerNode.tagName.toLowerCase()}#${i + 1}>`
          : `${sourcePrefix} stylesheet#${i + 1}`);

      scanStyleSheet(sheet, source, sheet.ownerNode || null);
    });
  }

  function collectShadowRoots(root, acc) {
    (root.querySelectorAll ? root.querySelectorAll('*') : []).forEach(el => {
      if (el.shadowRoot) {
        acc.push(el.shadowRoot);
        collectShadowRoots(el.shadowRoot, acc);
      }
    });
    return acc;
  }

  function scanIframes() {
    document.querySelectorAll('iframe').forEach((iframe, i) => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;

        scanRoot(doc, `iframe#${i + 1}`);

        const iframeShadowRoots = collectShadowRoots(doc, []);
        iframeShadowRoots.forEach(sr => {
          const host = sr.host;
          scanRoot(
            sr,
            `iframe#${i + 1} shadow:${host.tagName.toLowerCase()}${host.id ? '#' + host.id : ''}`
          );
        });
      } catch {}
    });
  }

  // --- Run audit: document, shadow roots, same-origin iframes ---

  scanRoot(document, 'document');

  const shadowRoots = collectShadowRoots(document, []);
  shadowRoots.forEach(sr => {
    const host = sr.host;
    scanRoot(sr, 'shadow:' + host.tagName.toLowerCase() + (host.id ? '#' + host.id : ''));
  });

  scanIframes();

  const seenVars = new Set(results.filter(r => r.variable).map(r => r.variable));
  Object.keys(EXPECTED).forEach(v => {
    if (!seenVars.has(v)) {
      pushResult(enrichResult({
        auditType: 'fallback',
        variable: v,
        property: null,
        fallback: null,
        source: '—',
        el: null,
        selector: null,
        status: 'not-found',
        expected: EXPECTED[v],
        snippet: null,
        libraryHint: null,
      }));
    }
  });

  const counts = {};
  results.forEach(r => counts[r.status] = (counts[r.status] || 0) + 1);
  const vueMatLibCount = results.filter(r => r.libraryHint === 'vue-mat-lib').length;
  const nonVueMatLibCount = results.filter(r => getLibraryBucket(r.libraryHint) === 'non-vue-mat-lib').length;

  console.group('%c🔍 SMX CSS Audit', `color:${UI.accent};font-weight:bold;font-size:14px`);
  console.log(
    `✅ OK: ${counts.ok||0}  ⚠️ Wrong: ${counts.wrong||0}  ❌ Missing: ${counts['missing-fallback']||0}  🎨 Non-themed: ${counts['non-themed']||0}  🧩 vue-mat-lib: ${vueMatLibCount}  ◻ non-vue-mat-lib: ${nonVueMatLibCount}  🔵 Not on page: ${counts['not-found']||0}  ❓ Unknown: ${counts['unknown-var']||0}  👁 Shadow roots: ${shadowRoots.length}`
  );
  results.forEach(r => {
    const icon = {
      ok: '✅',
      wrong: '⚠️',
      'missing-fallback': '❌',
      'unknown-var': '❓',
      'not-found': '🔵',
      'non-themed': '🎨'
    }[r.status] || '•';

    const label = r.variable || r.property || '(unknown)';

    console.log(
      `${icon} ${label}` +
      `${r.auditType ? '\n   audit:    ' + r.auditType : ''}` +
      `${r.libraryHint ? '\n   flag:     ' + r.libraryHint : ''}` +
      `${r.locator ? '\n   locator:  ' + r.locator : ''}` +
      `${r.selector ? '\n   selector: ' + r.selector : ''}` +
      `${r.matchCount != null ? '\n   live:     ' + r.matchCount : ''}` +
      `${r.exampleElements?.length ? '\n   examples: ' + r.exampleElements.join(' | ') : ''}` +
      `${r.vueScopeAttr ? '\n   vue:      ' + r.vueScopeAttr : ''}` +
      `${r.shadowHost ? '\n   shadow:   ' + r.shadowHost : ''}` +
      `${r.snippet ? '\n   snippet:  ' + shorten(r.snippet, 220) : ''}` +
      `\n   source: ${r.source}` +
      `${r.expected && r.status !== 'ok' ? '\n   expected: ' + r.expected : ''}` +
      `${r.fallback != null ? '\n   found:    ' + r.fallback : ''}`
    );
  });
  console.groupEnd();

  // --- UI: floating panel (filters, grouped cards, copy) ---

  const STATUS_META = {
    'ok':               { label: '✅ Correct',           color: UI.ok,        bg: UI.okBg },
    'wrong':            { label: '⚠️ Wrong fallback',    color: UI.wrong,     bg: UI.wrongBg },
    'missing-fallback': { label: '❌ Missing fallback',  color: UI.missing,   bg: UI.missingBg },
    'unknown-var':      { label: '❓ Unknown var',        color: UI.unknown,   bg: UI.unknownBg },
    'not-found':        { label: '🔵 Not on page',       color: UI.notFound,  bg: UI.notFoundBg },
    'non-themed':       { label: '🎨 Non-themed value',  color: UI.nonThemed, bg: UI.nonThemedBg },
  };

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  Object.assign(panel.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
    width: '680px',
    maxHeight: '82vh',
    overflowY: 'auto',
    background: UI.panelBg,
    color: UI.panelText,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '12px',
    lineHeight: '1.45',
    borderRadius: '12px',
    boxShadow: '0 20px 50px rgba(0,0,0,.55)',
    border: `1px solid ${UI.panelBorder}`,
  });

  const hdr = document.createElement('div');
  Object.assign(hdr.style, {
    padding: '12px 16px',
    background: UI.headerBg,
    borderBottom: `1px solid ${UI.accentSoft}`,
    position: 'sticky',
    top: '0',
    zIndex: '4',
  });

  hdr.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px">
      <span style="color:${UI.accent};font-weight:800;font-size:14px">🔍 SMX CSS Audit</span>
      <div style="display:flex;gap:8px;align-items:center">
        <button
          id="__smx_download_csv__"
          style="
            background:${UI.sectionBg};
            color:${UI.panelText};
            border:1px solid #475569;
            border-radius:8px;
            padding:6px 10px;
            cursor:pointer;
            font:inherit;
            font-size:11px;
          "
        >Download CSV</button>
        <button id="__smx_close__" style="background:none;border:none;color:${UI.panelSubtle};cursor:pointer;font-size:18px;padding:0;line-height:1">✕</button>
      </div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;margin-bottom:10px">
      <span style="color:${UI.ok}">✅ ${counts.ok||0} correct</span>
      <span style="color:${UI.wrong}">⚠️ ${counts.wrong||0} wrong</span>
      <span style="color:${UI.missing}">❌ ${counts['missing-fallback']||0} missing</span>
      <span style="color:${UI.nonThemed}">🎨 ${counts['non-themed']||0} non-themed</span>
      <span style="color:${UI.library}">🧩 ${vueMatLibCount} vue-mat-lib</span>
      <span style="color:${UI.panelMuted}">◻ ${nonVueMatLibCount} non-vue-mat-lib</span>
      <span style="color:${UI.notFound}">🔵 ${counts['not-found']||0} not found</span>
      <span style="color:${UI.unknown}">❓ ${counts['unknown-var']||0} unknown</span>
    </div>
    <div style="background:${UI.sectionBg};border:1px solid #334155;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:11px;line-height:1.75">
      <div style="color:${UI.panelSubtle};margin-bottom:4px;letter-spacing:0.06em;font-size:10px">INLINE ELEMENT HIGHLIGHTS</div>
      <div><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${UI.ok};margin-right:6px;vertical-align:middle"></span><span style="color:${UI.panelMuted}">Green — fallback is correct</span></div>
      <div><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#e040fb;margin-right:6px;vertical-align:middle"></span><span style="color:${UI.panelMuted}">Pink — wrong, unknown, or non-themed</span></div>
      <div><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${UI.missing};margin-right:6px;vertical-align:middle"></span><span style="color:${UI.panelMuted}">Red — no real fallback defined</span></div>
      <div style="color:${UI.panelFaint};margin-top:4px">Only visible on elements with inline styles.</div>
    </div>
    <div style="font-size:11px;color:${UI.panelSubtle}">👁 ${shadowRoots.length} shadow root${shadowRoots.length!==1?'s':''} scanned · TSV copied ✓</div>
  `;
  panel.appendChild(hdr);

  const filtersWrap = document.createElement('div');
  Object.assign(filtersWrap.style, {
    padding: '8px 14px',
    borderBottom: '1px solid #ffffff08',
    position: 'sticky',
    top: '186px',
    background: UI.panelBg,
    zIndex: '3',
  });

  let activeStatusFilter = 'all';
  let activeLibraryFilter = 'all';
  let activeSearch = '';

  const statusFilterBtns = {};
  const libraryFilterBtns = {};

  const statusDefs = [
    ['all',              'All statuses'],
    ['missing-fallback', '❌ Missing'],
    ['wrong',            '⚠️ Wrong'],
    ['non-themed',       '🎨 Non-themed'],
    ['ok',               '✅ Correct'],
    ['not-found',        '🔵 Not found'],
    ['unknown-var',      '❓ Unknown'],
  ];

  const libraryDefs = [
    ['all',             'all'],
    ['vue-mat-lib',     'vue-mat-lib'],
    ['non-vue-mat-lib', 'non-vue-mat-lib'],
  ];

  function styleFilterButton(btn, active, activeColor) {
    btn.style.background = active ? activeColor + '33' : 'none';
    btn.style.border = '1px solid ' + (active ? activeColor : '#475569');
    btn.style.color = active ? activeColor : UI.panelMuted;
  }

  function buildFilterSection(title, defs, store, activeGetter, activeColor) {
    const section = document.createElement('div');
    section.style.marginBottom = '8px';

    const label = document.createElement('div');
    label.textContent = title;
    Object.assign(label.style, {
      fontSize: '10px',
      color: UI.panelSubtle,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      marginBottom: '5px',
    });
    section.appendChild(label);

    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap',
    });

    defs.forEach(([key, labelText]) => {
      const btn = document.createElement('button');
      btn.textContent = labelText;
      Object.assign(btn.style, {
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '11px',
        padding: '4px 10px',
        background: 'none',
        font: 'inherit',
      });

      styleFilterButton(btn, key === activeGetter(), activeColor);

      btn.onclick = () => {
        store.set(key);
        defs.forEach(([k]) => {
          styleFilterButton(store.buttons[k], k === activeGetter(), activeColor);
        });
        renderRows();
      };

      store.buttons[key] = btn;
      row.appendChild(btn);
    });

    section.appendChild(row);
    return section;
  }

  const statusStore = {
    buttons: statusFilterBtns,
    set(value) { activeStatusFilter = value; }
  };

  const libraryStore = {
    buttons: libraryFilterBtns,
    set(value) { activeLibraryFilter = value; }
  };

  filtersWrap.appendChild(
    buildFilterSection('Status', statusDefs, statusStore, () => activeStatusFilter, UI.accent)
  );

  filtersWrap.appendChild(
    buildFilterSection('Library ownership', libraryDefs, libraryStore, () => activeLibraryFilter, UI.library)
  );

  panel.appendChild(filtersWrap);

  const searchWrap = document.createElement('div');
  Object.assign(searchWrap.style, {
    padding: '10px 14px',
    borderBottom: '1px solid #1f2937',
    background: UI.panelBg,
    position: 'sticky',
    top: '296px',
    zIndex: '3',
  });

  searchWrap.innerHTML = `
    <div style="font-size:10px;color:${UI.panelSubtle};letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px">Search</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input
        id="__smx_search__"
        type="text"
        placeholder="Filter by selector, token, snippet, source..."
        style="
          width:100%;
          background:${UI.sectionBg};
          color:${UI.panelText};
          border:1px solid #475569;
          border-radius:8px;
          padding:8px 10px;
          font:inherit;
          outline:none;
        "
      />
      <button
        id="__smx_search_clear__"
        style="
          background:${UI.sectionBg};
          color:${UI.panelMuted};
          border:1px solid #475569;
          border-radius:8px;
          padding:8px 10px;
          cursor:pointer;
          font:inherit;
        "
      >Clear</button>
    </div>
  `;
  panel.appendChild(searchWrap);

  const groupControls = document.createElement('div');
  Object.assign(groupControls.style, {
    padding: '8px 14px',
    borderBottom: '1px solid #1f2937',
    background: UI.panelBg,
    position: 'sticky',
    top: '360px',
    zIndex: '3',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  });

  groupControls.innerHTML = `
    <div style="font-size:10px;color:${UI.panelSubtle};letter-spacing:0.06em;text-transform:uppercase;margin-right:6px">Groups</div>
  `;

  function makeToolbarButton(label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      background: UI.sectionBg,
      color: UI.panelText,
      border: '1px solid #475569',
      borderRadius: '6px',
      padding: '5px 8px',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: '11px',
    });
    return btn;
  }

  const expandAllBtn = makeToolbarButton('Expand all');
  const collapseAllBtn = makeToolbarButton('Collapse all');

  groupControls.appendChild(expandAllBtn);
  groupControls.appendChild(collapseAllBtn);
  panel.appendChild(groupControls);

  const rowContainer = document.createElement('div');
  panel.appendChild(rowContainer);

  const searchInput = searchWrap.querySelector('#__smx_search__');
  const searchClear = searchWrap.querySelector('#__smx_search_clear__');

  searchInput.addEventListener('input', () => {
    activeSearch = searchInput.value.trim().toLowerCase();
    renderRows();
  });

  searchClear.addEventListener('click', () => {
    activeSearch = '';
    searchInput.value = '';
    renderRows();
  });

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function filterResults(items) {
    let filtered = items;

    if (activeStatusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === activeStatusFilter);
    }

    if (activeLibraryFilter === 'vue-mat-lib') {
      filtered = filtered.filter(r => r.libraryHint === 'vue-mat-lib');
    } else if (activeLibraryFilter === 'non-vue-mat-lib') {
      filtered = filtered.filter(r => getLibraryBucket(r.libraryHint) === 'non-vue-mat-lib');
    }

    if (activeSearch) {
      filtered = filtered.filter(r => {
        const haystack = [
          r.auditType || '',
          r.variable || '',
          r.property || '',
          r.selector || '',
          r.snippet || '',
          r.source || '',
          r.fallback || '',
          r.expected || '',
          r.libraryHint || '',
          r.locator || '',
          r.searchText || '',
          r.shadowHost || '',
          r.vueScopeAttr || '',
          ...(r.exampleElements || []),
        ].join(' ').toLowerCase();

        return haystack.includes(activeSearch);
      });
    }

    return filtered;
  }

  function makeActionButton(label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      background: UI.sectionBg,
      color: UI.panelText,
      border: '1px solid #475569',
      borderRadius: '6px',
      padding: '5px 8px',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: '11px',
    });
    return btn;
  }

  function renderRows() {
    rowContainer.innerHTML = '';

    const filtered = filterResults(results);

    if (!filtered.length) {
      rowContainer.innerHTML = `<div style="padding:18px;color:${UI.panelMuted};text-align:center">No results for this filter/search combination.</div>`;
      return;
    }

    const grouped = {};
    filtered.forEach(r => {
      const key = r.variable || r.property || '(unknown)';
      (grouped[key] = grouped[key] || []).push(r);
    });

    Object.entries(grouped).forEach(([groupLabel, entries]) => {
      const section = document.createElement('div');
      section.style.cssText = 'border-bottom:1px solid #1f2937;padding:10px 14px';

      const isCollapsed = collapsedGroups.has(groupLabel);

      const header = document.createElement('button');
      header.type = 'button';
      Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        background: 'none',
        border: 'none',
        padding: '0',
        margin: '0 0 8px 0',
        cursor: 'pointer',
        textAlign: 'left',
        color: UI.accent,
        font: 'inherit',
      });

      header.innerHTML = `
        <span style="color:${UI.panelMuted};font-size:12px;flex:0 0 auto">${isCollapsed ? '▸' : '▾'}</span>
        <span style="color:${UI.accent};font-weight:800;word-break:break-all;font-size:13px">${esc(groupLabel)}</span>
        <span style="color:${UI.panelSubtle};font-size:11px;margin-left:auto;flex:0 0 auto">${entries.length}</span>
      `;

      header.onclick = () => {
        if (collapsedGroups.has(groupLabel)) {
          collapsedGroups.delete(groupLabel);
        } else {
          collapsedGroups.add(groupLabel);
        }
        renderRows();
      };

      section.appendChild(header);

      const content = document.createElement('div');
      content.style.display = isCollapsed ? 'none' : 'block';
      section.appendChild(content);

      entries.forEach(r => {
        const meta = STATUS_META[r.status] || { label: r.status, color: UI.panelText, bg: UI.sectionBg };
        const card = document.createElement('div');

        Object.assign(card.style, {
          background: meta.bg,
          border: '1px solid ' + meta.color,
          borderRadius: '8px',
          padding: '8px 10px',
          marginBottom: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        });

        let html = `<span style="color:${meta.color};font-size:11px;font-weight:bold">${meta.label}</span>`;

        if (r.status === 'unknown-var' && r.variable) {
          html += `<div style="color:#fde68a"><strong>token:</strong> ${esc(r.variable)}</div>`;
        }

        html += `<div><span style="color:${UI.panelSubtle}">audit: </span><span style="color:${UI.panelText}">${esc(r.auditType || '')}</span></div>`;
        html += `<div><span style="color:${UI.panelSubtle}">library: </span><span style="color:${r.libraryHint === 'vue-mat-lib' ? UI.library : UI.panelMuted}">${esc(getLibraryBucket(r.libraryHint))}</span></div>`;
        html += `<div><span style="color:${UI.panelSubtle}">locator: </span><span style="color:${UI.panelText}">${esc(r.locator || '')}</span></div>`;

        if (r.property) {
          html += `<div><span style="color:${UI.panelSubtle}">property: </span><span style="color:${UI.panelText}">${esc(r.property)}</span></div>`;
        }

        if (r.selector) {
          html += `<div><span style="color:${UI.panelSubtle}">selector: </span><span style="color:${UI.panelText}">${esc(r.selector)}</span></div>`;
        }

        if (r.matchCount != null) {
          html += `<div><span style="color:${UI.panelSubtle}">live matches: </span><span style="color:${UI.panelText}">${esc(String(r.matchCount))}</span></div>`;
        }

        if (r.matchCount === 0) {
          html += `<div style="color:${UI.panelMuted};font-size:11px">Rule found, but no current DOM match.</div>`;
        }

        if (r.exampleElements && r.exampleElements.length) {
          html += `<div><span style="color:${UI.panelSubtle}">examples: </span><span style="color:${UI.panelText}">${esc(r.exampleElements.join(' • '))}</span></div>`;
        }

        if (r.vueScopeAttr) {
          html += `<div><span style="color:${UI.panelSubtle}">vue scope: </span><span style="color:${UI.panelText}">${esc(r.vueScopeAttr)}</span></div>`;
        }

        if (r.shadowHost) {
          html += `<div><span style="color:${UI.panelSubtle}">shadow host: </span><span style="color:${UI.panelText}">${esc(r.shadowHost)}</span></div>`;
        }

        const shortSnippet = r.snippet ? shorten(r.snippet, 220) : '';
        if (shortSnippet) {
          html += `<div style="background:${UI.codeBg};border:1px solid #334155;border-radius:6px;padding:6px 8px;margin-top:1px;word-break:break-all;color:${UI.panelText}">${esc(shortSnippet)}</div>`;
        }

        if (r.fallback != null && r.status !== 'not-found') {
          html += `<div><span style="color:${UI.panelSubtle}">found: </span><span style="color:#fde68a">${esc(r.fallback)}</span></div>`;
        }

        if ((r.status === 'wrong' || r.status === 'missing-fallback') && r.expected) {
          html += `<div><span style="color:${UI.panelSubtle}">expected: </span><span style="color:#bbf7d0">${esc(r.expected)}</span></div>`;
        }

        if (r.status === 'not-found') {
          html += `<div style="color:${UI.panelMuted};font-size:11px">Not found in any stylesheet, inline style, shadow root, or same-origin iframe on this page.</div>`;
          html += `<div><span style="color:${UI.panelSubtle}">default: </span><span style="color:#bbf7d0">${esc(r.expected)}</span></div>`;
        }

        if (r.source && r.source !== '—') {
          const short = r.source === 'inline'
            ? '(inline style)'
            : r.source.replace(/^https?:\/\/[^/]+/, '');
          html += `<div style="color:${UI.panelMuted};font-size:11px">${esc(short)}</div>`;
        }

        card.innerHTML = html;

        const actions = document.createElement('div');
        Object.assign(actions.style, {
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          marginTop: '4px',
        });

        const copyLocatorBtn = makeActionButton('Copy locator');
        copyLocatorBtn.onclick = () => copyText(r.locator || '', copyLocatorBtn);

        const copySearchBtn = makeActionButton('Copy search text');
        copySearchBtn.onclick = () => copyText(r.searchText || '', copySearchBtn);

        actions.appendChild(copyLocatorBtn);
        actions.appendChild(copySearchBtn);

        card.appendChild(actions);
        content.appendChild(card);
      });

      rowContainer.appendChild(section);
    });
  }

  expandAllBtn.onclick = () => {
    collapsedGroups.clear();
    renderRows();
  };

  collapseAllBtn.onclick = () => {
    collapsedGroups.clear();

    const grouped = {};
    filterResults(results).forEach(r => {
      const key = r.variable || r.property || '(unknown)';
      (grouped[key] = grouped[key] || []).push(r);
    });

    Object.keys(grouped).forEach(key => collapsedGroups.add(key));
    renderRows();
  };

  renderRows();
  document.body.appendChild(panel);

  document.getElementById('__smx_download_csv__').onclick = () => {
    downloadCsv(filterResults(results));
  };

  document.getElementById('__smx_close__').onclick = () => panel.remove();
})();