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
        pagination: {
          selector: '.s-pagination-next',
          maxPages: 10,
          waitStrategy: 'navigation',
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
  {
    domain: 'reddit.com',
    version: '2',
    description: 'Reddit posts — rewrites to old.reddit.com for stable, server-rendered DOM',
    pages: {
      post: {
        urlPattern: '/comments/',
        description: 'Post with full comment thread via old.reddit.com',
        urlRewrite: { from: 'reddit.com', to: 'old.reddit.com' },
        scrollDepth: 'none',
        container: '.comment',
        fields: {
          author: { selector: '.author', type: 'text' },
          score: { selector: '.score.unvoted', type: 'text' },
          body: { selector: '.usertext-body .md', type: 'text' },
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

// --- Post-Processing: domain-specific data normalization ---

/**
 * Normalize common patterns across all domains.
 */
function normalizeCommon(item) {
  for (const [key, val] of Object.entries(item)) {
    if (typeof val === 'string') {
      item[key] = val.trim();
    }
  }
  return item;
}

/**
 * Domain-specific post-processors.
 * Each function receives the extracted item and the URL, mutates in place.
 */
const POST_PROCESSORS = {
  'reddit.com': (item, url) => {
    // Clean up score text: "X points" → "X"
    if (item.score && typeof item.score === 'string') {
      const m = item.score.match(/(-?[\d]+)/);
      if (m) item.score = m[1];
    }
    return item;
  },
  'amazon.com': (item, url) => {
    // Rating: "4.6 out of 5 stars" → "4.6"
    if (item.rating && typeof item.rating === 'string') {
      const m = item.rating.match(/([\d.]+)\s+out of/);
      if (m) item.rating = m[1];
    }

    // Review count: "(21,300)" or "(21.3K)" → number string
    if (item.reviewCount && typeof item.reviewCount === 'string') {
      let rc = item.reviewCount.replace(/[()]/g, '').trim();
      if (rc.endsWith('K')) {
        rc = String(Math.round(parseFloat(rc) * 1000));
      } else {
        rc = rc.replace(/,/g, '');
      }
      item.reviewCount = rc;
    }

    // Brand: "Visit the BulkSupplements Store" → "BulkSupplements"
    if (item.brand && typeof item.brand === 'string') {
      item.brand = item.brand
        .replace(/^Visit the\s+/i, '')
        .replace(/\s+Store$/i, '')
        .trim();
    }

    // Features: truncate each bullet to first sentence (before first period + space)
    if (Array.isArray(item.features)) {
      item.features = item.features.map(f => {
        const firstSentence = f.match(/^[^.]+\./);
        return firstSentence ? firstSentence[0] : f.slice(0, 100);
      });
    }

    // Add clean URL from ASIN if available
    if (item.asin) {
      item.url = 'amazon.com/dp/' + item.asin;
    } else {
      // Extract ASIN from page URL for product pages
      const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/);
      if (asinMatch) {
        item.asin = asinMatch[1];
        item.url = 'amazon.com/dp/' + asinMatch[1];
      }
    }

    // Price: ensure it starts with $ and is clean
    if (item.price && typeof item.price === 'string') {
      const priceMatch = item.price.match(/\$[\d,.]+/);
      if (priceMatch) item.price = priceMatch[0];
    }

    return item;
  },
};

/**
 * Apply post-processing to extraction results.
 */
function postProcess(domain, data, url) {
  const processor = POST_PROCESSORS[domain];
  if (!processor && !data) return data;

  if (data.items) {
    data.items = data.items.map(item => {
      normalizeCommon(item);
      if (processor) processor(item, url);
      return item;
    });
  } else if (data.item) {
    normalizeCommon(data.item);
    if (processor) processor(data.item, url);
  }

  return data;
}

// --- Navigation Helper ---

/**
 * Navigate a tab to a URL and wait for the page to fully load.
 * @param {number} tabId
 * @param {string} url
 * @returns {Promise<void>}
 */
async function navigateAndWait(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await new Promise((resolve) => {
    const listener = (tid, info) => {
      if (tid === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

// --- Scroll-to-Load: trigger lazy content before extraction ---

/**
 * Inject a scroll script into the page to trigger lazy-loaded content.
 * @param {number} tabId
 * @param {string} scrollDepth - 'none', 'full', or 'pages:N'
 * @returns {Promise<{ scrolled: number }>}
 */
async function scrollPage(tabId, scrollDepth) {
  if (!scrollDepth || scrollDepth === 'none') return { scrolled: 0 };

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (mode) => {
      const maxScrolls = mode === 'full' ? 30 : parseInt(mode.split(':')[1]) || 3;
      let scrolled = 0;

      for (let i = 0; i < maxScrolls; i++) {
        const prevHeight = document.body.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);

        // Wait up to 2 seconds for new content to load
        let loaded = false;
        for (let w = 0; w < 20; w++) {
          await new Promise(r => setTimeout(r, 100));
          if (document.body.scrollHeight > prevHeight) {
            loaded = true;
            break;
          }
        }

        scrolled++;

        // In 'full' mode, stop when no new content loads
        if (mode === 'full' && !loaded) break;
      }

      // Scroll back to top (clean state for user)
      window.scrollTo(0, 0);
      return { scrolled };
    },
    args: [scrollDepth],
    world: 'ISOLATED',
  });

  return results?.[0]?.result || { scrolled: 0 };
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

    // URL rewrite: navigate tab to a different URL before extracting
    // (e.g., reddit.com → old.reddit.com for server-rendered content)
    // After extraction, navigates back to the original URL.
    let originalUrl = null;
    if (page.urlRewrite) {
      const currentUrl = new URL(url);
      const matchesFrom = currentUrl.hostname === page.urlRewrite.from
        || currentUrl.hostname === 'www.' + page.urlRewrite.from;
      const alreadyRewritten = currentUrl.hostname === page.urlRewrite.to
        || currentUrl.hostname === 'www.' + page.urlRewrite.to;

      if (matchesFrom) {
        originalUrl = url; // save for restore after extraction
        const newUrl = url.replace(
          /^(https?:\/\/)(www\.)?[^/]+/,
          '$1' + page.urlRewrite.to
        );
        await navigateAndWait(tabId, newUrl);
        const updatedTab = await chrome.tabs.get(tabId);
        url = updatedTab.url || url;
      } else if (alreadyRewritten) {
        // User is already on the rewritten domain (e.g., old.reddit.com)
        // No navigation needed, no restore needed
      }
    }

    // Scroll to trigger lazy-loaded content if schema requests it
    if (page.scrollDepth && page.scrollDepth !== 'none') {
      await scrollPage(tabId, page.scrollDepth);
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: buildExtractionScript(page),
      args: [{ container: page.container, fields: page.fields }],
      world: 'ISOLATED',
    });

    let data = results?.[0]?.result;

    // Apply domain-specific post-processing (normalize ratings, clean brands, etc.)
    if (data && !data.error) {
      data = postProcess(schema.domain, data, url);
    }

    // Restore original URL if we rewrote it (don't leave user on a different site)
    if (originalUrl) {
      // Fire and forget — don't await, extraction is done
      navigateAndWait(tabId, originalUrl);
    }

    return {
      type: 'structured',
      domain: schema.domain,
      pageType,
      schemaVersion: schema.version,
      url: originalUrl || url,
      data: data || { error: 'No result from extraction script' },
    };
  }

  // No schema — fall back to raw text + HTML for Defuddle processing
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      text: document.body.innerText,
      html: document.documentElement.outerHTML,
    }),
    world: 'ISOLATED',
  });

  const rawData = results?.[0]?.result || { text: '', html: '' };

  return {
    type: 'raw',
    domain: new URL(url).hostname,
    url,
    text: rawData.text || '',
    html: rawData.html || '',
  };
}

// --- DOM Probing: discover repeating patterns for schema suggestion ---

/**
 * Probe a tab's DOM structure to identify repeating element patterns
 * that could be extraction containers (product cards, list items, etc.).
 *
 * @param {number} tabId
 * @returns {Promise<object>} Probe results with candidate containers and sample fields
 */
async function probeDomStructure(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Count frequency of tagName.className combinations
      const selectorCounts = new Map();
      const selectorElements = new Map();

      for (const el of document.querySelectorAll('*')) {
        // Skip tiny/invisible elements and common layout containers
        if (el.children.length === 0 && !el.textContent?.trim()) continue;
        if (['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'BR', 'HR'].includes(el.tagName)) continue;

        // Build a reasonably specific selector
        let selector = el.tagName.toLowerCase();
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\s+/).filter(c => c.length > 0 && c.length < 40);
          if (classes.length > 0 && classes.length <= 3) {
            selector += '.' + classes.join('.');
          }
        }
        // Data attributes often identify components
        for (const attr of el.attributes) {
          if (attr.name.startsWith('data-') && attr.name !== 'data-reactid' && attr.value.length < 30) {
            selector = `[${attr.name}="${attr.value}"]`;
            break;
          }
        }

        selectorCounts.set(selector, (selectorCounts.get(selector) || 0) + 1);
        if (!selectorElements.has(selector)) selectorElements.set(selector, []);
        if (selectorElements.get(selector).length < 3) {
          selectorElements.get(selector).push(el);
        }
      }

      // Filter: keep selectors with 3+ occurrences (likely repeating items)
      const candidates = [];
      for (const [selector, count] of selectorCounts) {
        if (count < 3 || count > 500) continue; // too few = not a list, too many = layout noise

        const samples = selectorElements.get(selector) || [];
        if (samples.length === 0) continue;

        // Analyze the first sample element's children to find field candidates
        const sampleFields = [];
        const sample = samples[0];

        // Look for text-bearing children
        for (const child of sample.querySelectorAll('*')) {
          const text = child.textContent?.trim();
          if (!text || text.length < 2 || text.length > 200) continue;
          if (child.children.length > 3) continue; // container, not a leaf field

          let fieldSelector = child.tagName.toLowerCase();
          if (child.className && typeof child.className === 'string') {
            const cls = child.className.trim().split(/\s+/).filter(c => c.length > 0 && c.length < 40);
            if (cls.length > 0 && cls.length <= 2) fieldSelector += '.' + cls.join('.');
          }

          // Guess field name from content patterns
          let name = 'text';
          if (/^\$[\d,.]+/.test(text) || /^[\d,.]+\s*$/.test(text)) name = 'price';
          else if (/\d+(\.\d+)?\s*(out of|stars?|\/)/i.test(text)) name = 'rating';
          else if (/^\d+[\d,]*\s*(reviews?|ratings?)/i.test(text)) name = 'reviewCount';
          else if (child.tagName === 'A' || child.tagName === 'H1' || child.tagName === 'H2' || child.tagName === 'H3') name = 'title';

          // Avoid duplicates
          if (sampleFields.some(f => f.selector === fieldSelector)) continue;

          sampleFields.push({
            name,
            selector: fieldSelector,
            type: 'text',
            sample: text.slice(0, 80),
          });

          if (sampleFields.length >= 8) break;
        }

        if (sampleFields.length === 0) continue;

        candidates.push({ selector, count, sampleFields });
      }

      // Sort: prefer candidates with more fields and moderate count
      candidates.sort((a, b) => {
        const scoreA = a.sampleFields.length * 10 + Math.min(a.count, 50);
        const scoreB = b.sampleFields.length * 10 + Math.min(b.count, 50);
        return scoreB - scoreA;
      });

      return candidates.slice(0, 5); // Top 5 candidates
    },
    world: 'ISOLATED',
  });

  return results?.[0]?.result || [];
}

// --- Pagination: auto-follow "next" links across search result pages ---

/**
 * Extract structured data from a tab, following pagination links automatically.
 * Returns an array of extraction results — one per page.
 *
 * @param {number} tabId
 * @param {string} url - Starting URL
 * @param {number} maxPages - Maximum pages to extract (default 10)
 * @returns {Promise<object[]>} Array of extraction results
 */
async function extractWithPagination(tabId, url, maxPages = 10) {
  const results = [];

  const match = matchSchema(url);
  if (!match) {
    // No schema — can't paginate without knowing the "next" selector
    const single = await extractStructured(tabId, url);
    return [single];
  }

  const { schema, page, pageType } = match;
  if (!page.pagination) {
    // Schema exists but no pagination config — extract single page
    const single = await extractStructured(tabId, url);
    return [single];
  }

  const { selector: nextSelector, waitStrategy } = page.pagination;

  for (let pageNum = 0; pageNum < maxPages; pageNum++) {
    // Get current tab state
    const tab = await chrome.tabs.get(tabId);
    const currentUrl = tab.url;

    // Extract current page
    const result = await extractStructured(tabId, currentUrl);
    result.title = tab.title || 'untitled';
    results.push(result);

    // If extraction failed or returned no items, stop
    if (result.type !== 'structured' || result.data?.error) break;
    if (result.data?.items && result.data.items.length === 0) break;

    // Last page? Don't try to find "next"
    if (pageNum >= maxPages - 1) break;

    // Find the "next" link
    const nextResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        // Get href if it's a link, or null if it's a disabled/hidden element
        if (el.tagName === 'A' && el.href) return el.href;
        if (el.classList.contains('s-pagination-disabled')) return null;
        if (el.getAttribute('aria-disabled') === 'true') return null;
        // For buttons/spans that act as pagination, try clicking
        return '__CLICK__';
      },
      args: [nextSelector],
      world: 'ISOLATED',
    });

    const nextAction = nextResult?.[0]?.result;
    if (!nextAction) break; // No next link found — we're on the last page

    if (waitStrategy === 'mutation') {
      // SPA: click the element and wait for DOM changes
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const el = document.querySelector(sel);
          if (el) el.click();
        },
        args: [nextSelector],
        world: 'ISOLATED',
      });

      // Wait for DOM to update (poll for container count change)
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      // Navigation: click or navigate to URL and wait for full page load
      if (nextAction === '__CLICK__') {
        // Click the element and wait for navigation
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => {
            const el = document.querySelector(sel);
            if (el) el.click();
          },
          args: [nextSelector],
          world: 'ISOLATED',
        });
        // Wait for navigation to complete
        await new Promise((resolve) => {
          const listener = (tid, info) => {
            if (tid === tabId && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 15000);
        });
      } else {
        // Direct URL navigation
        await navigateAndWait(tabId, nextAction);
      }
    }

    // Brief settle delay for dynamic content
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}

// Export for service-worker.js
// (Service workers can't use ES modules in Chrome extensions,
// so we use importScripts and attach to globalThis)
globalThis.extractors = {
  loadSchemas,
  matchSchema,
  extractStructured,
  extractWithPagination,
  probeDomStructure,
  schemaRegistry,
};
