/**
 * extractors.js — Domain-specific structured extraction engine
 *
 * Loaded by the service worker. Provides:
 * - Schema registry (loaded from schemas/ via fetch at startup)
 * - Generic extraction function that runs inside a page via chrome.scripting
 * - Schema matching by URL domain + path pattern
 */

// --- Schema Registry ---

/** @type {Map<string, object>} domain → schema object */
const schemaRegistry = new Map();

// --- Built-in Schemas (inline for reliability — no fetch/cache issues) ---

const BUILTIN_SCHEMAS = [
  {
    domain: 'amazon.com',
    version: '2',
    description: 'Amazon product search results and detail pages',
    pages: {
      search: {
        urlPattern: '/s?',
        description: 'Search results listing page',
        container: "[data-component-type='s-search-result']",
        fields: {
          asin: { selector: '@data-asin', type: 'attribute' },
          title: { selector: 'h2 span', type: 'text' },
          price: { selector: '.a-price .a-offscreen', type: 'text' },
          rating: { selector: '.a-icon-alt', type: 'text' },
          reviewCount: { selector: 'span.s-underline-text', type: 'text' },
          prime: { selector: 'i.a-icon-prime', type: 'exists' },
        },
      },
      product: {
        urlPattern: '/dp/',
        description: 'Individual product detail page',
        fields: {
          title: { selector: '#productTitle', type: 'text' },
          price: { selector: '.a-price .a-offscreen', type: 'text' },
          rating: { selector: '#acrPopover span.a-icon-alt', type: 'text' },
          reviewCount: { selector: '#acrCustomerReviewText', type: 'text' },
          features: { selector: '#feature-bullets ul li span.a-list-item', type: 'textAll' },
          description: { selector: '#productDescription p', type: 'text' },
          brand: { selector: '#bylineInfo', type: 'text' },
        },
      },
    },
  },
];

/**
 * Load schemas: built-ins first, then override with any JSON files from schemas/ dir.
 */
async function loadSchemas() {
  // Load built-in schemas
  for (const schema of BUILTIN_SCHEMAS) {
    schemaRegistry.set(schema.domain, schema);
    console.log(`[extractors] Loaded built-in schema: ${schema.domain} v${schema.version}`);
  }

  // Try to load JSON overrides (these take precedence over built-ins)
  try {
    const response = await fetch(chrome.runtime.getURL('schemas/manifest.json'));
    const manifest = await response.json();

    for (const filename of manifest.schemas) {
      try {
        const schemaResponse = await fetch(chrome.runtime.getURL(`schemas/${filename}`) + '?v=' + Date.now());
        const schema = await schemaResponse.json();
        if (schema.domain) {
          schemaRegistry.set(schema.domain, schema);
          console.log(`[extractors] Loaded JSON schema override: ${schema.domain} v${schema.version}`);
        }
      } catch (err) {
        console.error(`[extractors] Failed to load schema ${filename}:`, err);
      }
    }
  } catch (err) {
    console.log('[extractors] No JSON schema manifest found, using built-ins only');
  }

  console.log(`[extractors] ${schemaRegistry.size} schema(s) ready`);
}

/**
 * Find a matching schema + page definition for a given URL.
 * @param {string} url
 * @returns {{ schema: object, page: object, pageType: string } | null}
 */
function matchSchema(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  // Try exact domain, then parent domain (e.g., www.amazon.com → amazon.com)
  const candidates = [hostname];
  const parts = hostname.split('.');
  if (parts.length > 2) {
    candidates.push(parts.slice(1).join('.'));
  }

  for (const domain of candidates) {
    const schema = schemaRegistry.get(domain);
    if (!schema || !schema.pages) continue;

    for (const [pageType, pageDef] of Object.entries(schema.pages)) {
      if (url.includes(pageDef.urlPattern)) {
        return { schema, page: pageDef, pageType };
      }
    }
  }

  return null;
}

/**
 * Build the extraction function that will be injected into the page.
 * This returns a self-contained function (no closures over extension scope)
 * that receives the page definition as an argument.
 *
 * @param {object} pageDef - The page definition from the schema
 * @returns {function} - Function to pass to chrome.scripting.executeScript
 */
function buildExtractionScript(pageDef) {
  // This function runs INSIDE the page context (isolated world).
  // It must be completely self-contained — no references to extension variables.
  return (pageDef) => {
    function extractField(element, fieldDef) {
      const { selector, type, attribute } = fieldDef;

      // @attr shorthand: read attribute from the element itself
      if (selector.startsWith('@')) {
        const attrName = selector.slice(1);
        const val = element.getAttribute(attrName);
        return val !== null ? val : null;
      }

      if (type === 'text') {
        const el = element.querySelector(selector);
        return el ? el.innerText.trim() : null;
      }

      if (type === 'textAll') {
        const els = element.querySelectorAll(selector);
        return Array.from(els).map(el => el.innerText.trim()).filter(Boolean);
      }

      if (type === 'attribute') {
        const el = element.querySelector(selector);
        if (!el) return null;
        const attrKey = attribute || 'href';
        return el.getAttribute(attrKey);
      }

      if (type === 'exists') {
        return element.querySelector(selector) !== null;
      }

      return null;
    }

    function extractFromElement(element, fields) {
      const result = {};
      for (const [fieldName, fieldDef] of Object.entries(fields)) {
        result[fieldName] = extractField(element, fieldDef);
      }
      return result;
    }

    try {
      const { container, fields } = pageDef;

      if (container) {
        // Repeating items (e.g., search results)
        const containers = document.querySelectorAll(container);
        const items = [];
        for (const el of containers) {
          const item = extractFromElement(el, fields);
          // Skip items where all fields are null (empty/sponsored placeholders)
          const hasData = Object.values(item).some(v => v !== null && v !== false);
          if (hasData) {
            items.push(item);
          }
        }
        return { items, count: items.length };
      } else {
        // Single-item page (e.g., product detail)
        const item = extractFromElement(document, fields);
        return { item };
      }
    } catch (err) {
      return { error: err.message || String(err) };
    }
  };
}

/**
 * Run structured extraction on a tab.
 * @param {number} tabId
 * @param {string} url - The tab's URL (for schema matching)
 * @returns {Promise<object>} Extraction result with type indicator
 */
async function extractStructured(tabId, url) {
  const match = matchSchema(url);

  if (match) {
    const { schema, page, pageType } = match;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: buildExtractionScript(page),
      args: [{ container: page.container, fields: page.fields }],
      world: 'ISOLATED',
    });

    const data = results?.[0]?.result;

    return {
      type: 'structured',
      domain: schema.domain,
      pageType,
      schemaVersion: schema.version,
      url,
      data: data || { error: 'No result from extraction script' },
    };
  }

  // No schema — fall back to raw innerText
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.body.innerText,
    world: 'ISOLATED',
  });

  const text = results?.[0]?.result || '';

  return {
    type: 'raw',
    domain: new URL(url).hostname,
    url,
    text,
  };
}

// Export for service-worker.js
// (Service workers can't use ES modules in Chrome extensions,
// so we use importScripts and attach to globalThis)
globalThis.extractors = {
  loadSchemas,
  matchSchema,
  extractStructured,
  schemaRegistry,
};
