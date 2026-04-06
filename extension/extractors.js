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
          title: { selector: '.a-text-normal', type: 'text' },
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
  {
    domain: 'walmart.com',
    version: '1',
    description: 'Walmart product search results',
    pages: {
      search: {
        urlPattern: '/search?q=',
        description: 'Search results listing page',
        container: '[data-item-id]',
        fields: {
          itemId: { selector: '@data-item-id', type: 'attribute' },
          title: { selector: '[data-automation-id="product-title"]', type: 'text' },
          price: { selector: '[data-automation-id="product-price"]', type: 'text' },
          reviewCount: { selector: '[data-testid="product-reviews"]', type: 'text' },
          ratingAndReviews: { selector: '[data-testid="product-ratings"]', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'ebay.com',
    version: '1',
    description: 'eBay product search results',
    pages: {
      search: {
        urlPattern: '/sch/',
        description: 'Search results listing page',
        container: '.s-card',
        fields: {
          title: { selector: '.s-card__title', type: 'text' },
          price: { selector: '.s-card__price', type: 'text' },
          condition: { selector: '.s-card__subtitle-row .su-styled-text', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'target.com',
    version: '1',
    status: 'experimental',
    description: 'Target product search results (experimental — uses :has() selector, React portal DOM structure)',
    pages: {
      search: {
        urlPattern: '/s?searchTerm=',
        description: 'Search results listing page',
        container: 'li:has([data-test="productCardVariantMini"])',
        fields: {
          title: { selector: '[data-test="productCardVariantMiniTitle"] a', type: 'text' },
          price: { selector: '[data-test="@web/Price/PriceAndPromoMinimal"]', type: 'text' },
          rating: { selector: '[data-test="ratings"]', type: 'text' },
          reviews: { selector: '[data-test="rating-count"]', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'bestbuy.com',
    version: '1',
    description: 'Best Buy product search results',
    pages: {
      search: {
        urlPattern: '/site/searchpage.jsp',
        description: 'Search results listing page',
        container: '.product-list-item',
        fields: {
          title: { selector: 'a.product-list-item-link', type: 'text' },
          price: { selector: '.priceView-customer-price span', type: 'text' },
          ratingText: { selector: '.c-reviews', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'newegg.com',
    version: '1',
    description: 'Newegg product search results',
    pages: {
      search: {
        urlPattern: '/p/pl?d=',
        description: 'Search results listing page',
        container: '.item-cell',
        fields: {
          title: { selector: '.item-title', type: 'text' },
          price: { selector: '.price-current', type: 'text' },
          shipping: { selector: '.price-ship', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'homedepot.com',
    version: '1',
    description: 'Home Depot product search results',
    pages: {
      search: {
        urlPattern: '/s/',
        description: 'Search results listing page',
        container: '.product-pod',
        fields: {
          title: { selector: '[data-testid="product-header"]', type: 'text' },
          price: { selector: '.price', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'costco.com',
    version: '1',
    status: 'experimental',
    description: 'Costco product search results (experimental — MUI-based DOM, containers may be unreliable)',
    pages: {
      search: {
        urlPattern: '/s?keyword=',
        description: 'Search results listing page',
        container: 'a[href*=".product."]',
        fields: {
          title: { selector: 'span', type: 'text' },
          price: { selector: 'span', type: 'textAll' },
        },
      },
    },
  },
  {
    domain: 'etsy.com',
    version: '1',
    status: 'experimental',
    description: 'Etsy product search results (experimental/unverified — CAPTCHA blocked DOM probing, selectors based on historical knowledge)',
    pages: {
      search: {
        urlPattern: '/search?q=',
        description: 'Search results listing page',
        container: '[data-listing-id]',
        fields: {
          listingId: { selector: '@data-listing-id', type: 'attribute' },
          title: { selector: 'h3', type: 'text' },
          price: { selector: '.currency-value', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'microcenter.com',
    version: '1',
    description: 'Micro Center product search results',
    pages: {
      search: {
        urlPattern: '/search/search_results.aspx',
        description: 'Search results listing page',
        container: '.product_wrapper',
        fields: {
          title: { selector: '.productClickItemV2', type: 'attribute', attribute: 'data-name' },
          price: { selector: '.price > span', type: 'text' },
          sku: { selector: '.sku', type: 'text' },
          rating: { selector: '.rating', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'bhphotovideo.com',
    version: '1',
    status: 'experimental',
    description: 'B&H Photo product search results (experimental — no reliable data-testid or semantic selectors found during probing)',
    pages: {
      search: {
        urlPattern: '/c/search?q=',
        description: 'Search results page',
        container: 'a[href*="/c/product/"]',
        fields: {
          title: { selector: 'span', type: 'text' },
        },
      },
      browse: {
        urlPattern: '/c/browse/',
        description: 'Category browse page',
        container: 'a[href*="/c/product/"]',
        fields: {
          title: { selector: 'span', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'chewy.com',
    version: '1',
    description: 'Chewy product search and category browse results',
    pages: {
      search: {
        urlPattern: '/s?query=',
        description: 'Search results listing page',
        container: '.kib-product-card',
        fields: {
          title: { selector: '.kib-product-title__text', type: 'text' },
          price: { selector: '[data-testid="kib-product-price"]', type: 'text' },
          rating: { selector: '.kib-product-rating__label', type: 'text' },
        },
      },
      category: {
        urlPattern: '/b/',
        description: 'Category browse page',
        container: '.kib-product-card',
        fields: {
          title: { selector: '.kib-product-title__text', type: 'text' },
          price: { selector: '[data-testid="kib-product-price"]', type: 'text' },
          rating: { selector: '.kib-product-rating__label', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'iherb.com',
    version: '1',
    description: 'iHerb product search results',
    pages: {
      search: {
        urlPattern: '/search?kw=',
        description: 'Search results listing page',
        container: '.product-cell',
        fields: {
          title: { selector: '[data-ga-product-name]', type: 'attribute', attribute: 'data-ga-product-name' },
          brand: { selector: '[data-ga-product-brand]', type: 'attribute', attribute: 'data-ga-product-brand' },
          price: { selector: '.price', type: 'text' },
          reviewCount: { selector: '.rating-count', type: 'text' },
        },
      },
    },
  },
  {
    domain: 'wayfair.com',
    version: '1',
    status: 'experimental',
    description: 'Wayfair product search results (experimental — container selectors based on data-hb-id attributes which may change)',
    pages: {
      search: {
        urlPattern: '/keyword.php?keyword=',
        description: 'Search results listing page',
        container: 'a[href*="/pdp/"]',
        fields: {
          title: { selector: 'span', type: 'text' },
          rating: { selector: '[aria-label*="Rated"]', type: 'attribute', attribute: 'aria-label' },
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
