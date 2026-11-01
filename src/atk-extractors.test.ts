import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { formatStructuredMarkdown } from './markdown-formatter.js';
import type { StructuredResult } from './types.js';

type Field = { selector: string | string[]; type: string; attribute?: string; exclude?: string; lineBreakBefore?: string };
type Page = { fields: Record<string, Field> };
type Schema = { domain: string; version: string; pages: Record<string, Page>; variants?: Record<string, unknown> };
type Extractors = {
  loadSchemas(): Promise<void>;
  matchSchema(url: string): { schema: Schema; page: Page; pageType: string } | null;
  extractStructured(tabId: number, url: string, options?: { variant?: string }): Promise<Omit<StructuredResult, 'title'>>;
  schemaRegistry: Map<string, Schema>;
};

const source = readFileSync(join(process.cwd(), 'extension', 'extractors.js'), 'utf8');
const atkSchema = JSON.parse(readFileSync(join(process.cwd(), 'schemas', 'americastestkitchen.com.json'), 'utf8')) as Schema;
const recipeUrl = 'https://www.americastestkitchen.com/recipes/9001-synthetic-loaf';

// Invented content exercises the captured ATK component structure without
// retaining saved pages, account data, or recipe text from the site.
const ingredientTexts = ['2 cups sample flour', '¾ cup water'];
const ingredientMarkup = ingredientTexts.map(text => `<div class="Ingredients_ingredient__fixture"><label>
  <input type="checkbox"><span>${text}</span><svg aria-hidden="true"><title>Checkbox icon</title></svg>
  </label></div>`).join('');
const printIngredients = ingredientTexts.map(text => `<span class="recipePrintBody_ingredient__fixture"><span>${text}</span></span>`).join('');
const instructionMarkup = (prefix: string) => `<ol class="${prefix}_instructionsList__fixture">
  <div class="${prefix}_instructionWrapper__fixture"><div class="${prefix}_nameWrapper__fixture"><p class="${prefix}_instructionName__fixture">MIX</p><div class="${prefix}_highlightBorder__fixture"></div></div><li class="${prefix}_instructionListItem__fixture"><span><p>Combine the <strong>invented</strong> ingredients.</p><p>Rest 20 minutes.</p></span></li></div>
  <div class="${prefix}_instructionWrapper__fixture"><li class="${prefix}_instructionListItem__fixture"><span>Bake the sample loaf.<br>Cool completely.</span></li></div>
  <li class="InstructionIctStep_ictCard__fixture">Promotional class card</li>
  </ol>`;
const recipeHtml = `<!doctype html><html><head>
  <link rel="canonical" href="${recipeUrl}?tracking=one#recipe">
  <meta name="author" content="Fixture Baker">
  </head><body>
  <div class="Shared_printOnly__fixture"><div class="recipePrintLayout_pageWrapper__fixture">
    <div class="recipePrintHeader_headerContent__fixture"><div class="recipePrintHeader_recipeDetails__fixture"><h2>Synthetic Loaf</h2>
      <p class="recipePrintHeader_recipePublishedOn__fixture">Published on October 1, 2026</p>
      <div class="recipePrintHeader_recipeInformation__fixture"><h3>Time</h3><p>Total Time 2 hours, plus 1 hour cooling</p></div>
      <div class="recipePrintHeader_recipeInformation__fixture"><h3>Yield</h3><p>Makes 1 sample loaf</p></div>
    </div></div>
    <div class="recipePrintBody_ingredientList__fixture">${printIngredients}</div>
    <div class="recipePrintBody_beforeYouBeginBlocks__fixture"><p>Use a <strong>sample</strong> pan.</p></div>
    ${instructionMarkup('recipePrintBody')}
  </div></div>
  <main id="recipe-v2-layout">
    <h1 class="RecipeHeader_headingH1__fixture">Synthetic Loaf</h1>
    <div class="RecipeDocumentByline_recipeDocumentByline__fixture"><a>Fixture Baker</a></div>
    <div class="RecipeStats_recipeStats__fixture"><a class="RecipeStats_statCard__fixture" href="${recipeUrl}#ratings-section">
      <div class="RecipeStats_row__fixture"><span>4.8</span><span>(1,234)</span></div>
    </a><a class="RecipeStats_statCard__fixture" href="${recipeUrl}#comments-section"><span>99</span><span>Comments</span></a></div>
    <div class="TimeAndYield_timeAndYield__fixture">
      <div class="TimeAndYield_card__fixture"><h3>Time</h3><span>Total Time 2 hours, plus 1 hour cooling</span></div>
      <div class="TimeAndYield_card__fixture"><h3>Yield</h3><span>Makes 1 sample loaf</span></div>
    </div>
    <div class="RecipeV2Layout_ingredAndEquip__fixture">
      <div class="RecipeV2Layout_mobile__fixture">${ingredientMarkup}</div>
      <div class="RecipeV2Layout_tablet__fixture">${ingredientMarkup}</div>
      <div class="RecipeV2Layout_desktop__fixture">${ingredientMarkup}</div>
    </div>
    <div class="beforeYouBegin_beforeYouBeginWrapper__fixture"><div class="beforeYouBegin_beforeYouBeginTextWrapper__fixture"><svg aria-hidden="true"></svg><div><p>Use a <strong>sample</strong> pan.</p></div></div></div>
    <div class="RecipeV2Layout_wtrw__fixture"><div><h2>Why This Recipe Works</h2><p>These are invented <a href="/test">test notes</a>.</p></div></div>
    <div id="recipe-inline-hidden-content">${instructionMarkup('instructions')}</div>
  </main>
  <aside><div class="Ingredients_ingredient__unrelated">Recommendation ingredient</div></aside>
  </body></html>`;

async function harness(html = recipeHtml) {
  const { document } = parseHTML(html);
  const context = vm.createContext({
    document, URL,
    console: { log() {}, error() {} },
    fetch: async () => { throw new Error('Exercise built-in schemas without network'); },
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      scripting: {
        executeScript: async ({ func, args = [] }: { func: (...args: unknown[]) => unknown; args?: unknown[] }) => {
          context.injectedArgs = args;
          return [{ result: vm.runInContext(`(${func.toString()})(...injectedArgs)`, context) }];
        },
      },
    },
  });
  vm.runInContext(source, context);
  const extractors = context.extractors as Extractors;
  await extractors.loadSchemas();
  return { document, extractors };
}

describe('America’s Test Kitchen schema registration and route boundaries', () => {
  it('keeps the offline built-in schema identical to the source', async () => {
    const { extractors } = await harness();
    expect(extractors.schemaRegistry.get('americastestkitchen.com')).toEqual(atkSchema);
  });

  it.each([
    recipeUrl, `${recipeUrl}/?queryID=fixture#recipe`,
    'https://americastestkitchen.com/recipes/9001-synthetic-loaf',
  ])('matches an actual recipe route %s', async url => {
    const { extractors } = await harness();
    expect(extractors.matchSchema(url)?.pageType).toBe('recipe');
  });

  it.each([
    'https://www.americastestkitchen.com/',
    'https://www.americastestkitchen.com/search?next=/recipes/9001-synthetic-loaf',
    'https://www.americastestkitchen.com/articles/9001-synthetic-loaf',
    'https://www.americastestkitchen.com/recipes/synthetic-loaf',
    `${recipeUrl}/reviews`,
    'https://www.americastestkitchen.com/recipes/9001-',
    'https://americastestkitchen.com.evil.example/recipes/9001-synthetic-loaf',
    'https://notamericastestkitchen.com/recipes/9001-synthetic-loaf',
    'not a URL',
  ])('rejects unsupported or misleading route %s', async url => {
    const { extractors } = await harness();
    expect(extractors.matchSchema(url)).toBeNull();
  });
});

describe('America’s Test Kitchen recipe extraction', () => {
  it('keeps one ingredient list, ordered complete steps, metadata and inline text without mutating the page', async () => {
    const { document, extractors } = await harness();
    const before = document.toString();
    const result = await extractors.extractStructured(1, recipeUrl);
    expect(result.data.error).toBeUndefined();
    expect(result.data.item).toMatchObject({
      title: 'Synthetic Loaf', itemId: recipeUrl, recipeId: '9001', author: 'Fixture Baker',
      rating: '4.8', ratingCount: '1234',
      ingredients: ingredientTexts,
    });
    expect(result.data.item?.time).toContain('plus 1 hour cooling');
    expect(result.data.item?.yield).toBe('Makes 1 sample loaf');
    expect(result.data.item?.instructions).toEqual([
      '1. MIX\n\nCombine the invented ingredients.\nRest 20 minutes.',
      '2. Bake the sample loaf.\nCool completely.',
    ]);
    expect(JSON.stringify(result.data.item?.beforeYouBegin)).toContain('Use a sample pan.');
    expect(JSON.stringify(result.data.item?.whyThisWorks)).toContain('These are invented test notes.');
    expect(document.toString()).toBe(before);
    expect(document.querySelectorAll('input')).toHaveLength(6);
  });

  it('preserves the ingredient and step arrays in the saved Markdown representation', async () => {
    const { extractors } = await harness();
    const result = await extractors.extractStructured(1, recipeUrl);
    const markdown = formatStructuredMarkdown({ ...result, title: 'Synthetic Loaf' });
    expect(markdown).toContain('ingredients:\n- 2 cups sample flour\n- ¾ cup water');
    expect(markdown).toContain('1. MIX\n\nCombine the invented ingredients.\nRest 20 minutes.');
    expect(markdown).toContain('2. Bake the sample loaf.\nCool completely.');
    expect(markdown).not.toContain('Promotional class card');
    expect(markdown).not.toContain('Recommendation ingredient');
  });

  it('falls back to the print layout when responsive cooking content is absent', async () => {
    const { document, extractors } = await harness();
    document.querySelector('#recipe-v2-layout')?.remove();
    const before = document.toString();
    const result = await extractors.extractStructured(1, recipeUrl, { variant: 'cooking' });
    expect(result.data.error).toBeUndefined();
    expect(result.data.item?.ingredients).toEqual(ingredientTexts);
    expect(result.data.item?.time).toContain('plus 1 hour cooling');
    expect(result.data.item?.yield).toBe('Makes 1 sample loaf');
    expect(result.data.item?.instructions).toEqual([
      '1. MIX\n\nCombine the invented ingredients.\nRest 20 minutes.',
      '2. Bake the sample loaf.\nCool completely.',
    ]);
    expect(document.toString()).toBe(before);
  });

  it.each(['tablet', 'mobile'])('uses one complete %s ingredient list when larger layouts are missing', async layout => {
    const { document, extractors } = await harness();
    document.querySelector("[class*='RecipeV2Layout_desktop__']")?.remove();
    if (layout === 'mobile') document.querySelector("[class*='RecipeV2Layout_tablet__']")?.remove();
    const result = await extractors.extractStructured(1, recipeUrl);
    expect(result.data.error).toBeUndefined();
    expect(result.data.item?.ingredients).toEqual(ingredientTexts);
  });

  it.each(['ingredients', 'instructions'])('rejects partial Full and cooking records missing %s', async field => {
    for (const variant of [undefined, 'cooking']) {
      const { document, extractors } = await harness();
      const selectors = field === 'ingredients'
        ? "[class*='Ingredients_ingredient__'], [class*='recipePrintBody_ingredient__']"
        : "[class*='instructions_instructionWrapper__'], [class*='recipePrintBody_instructionWrapper__']";
      document.querySelectorAll(selectors).forEach(node => node.remove());
      const result = await extractors.extractStructured(1, recipeUrl, { variant });
      expect(result.data.error, variant).toMatch(new RegExp(`Required fields missing:.*${field}`));
      expect(result.data.item).toBeUndefined();
    }
  });

  it('allows a metadata projection without ingredients, instructions or optional notes', async () => {
    const { document, extractors } = await harness();
    document.querySelectorAll("[class*='Ingredients_ingredient__'], [class*='recipePrintBody_ingredient__'], [class*='instructions_instructionWrapper__'], [class*='recipePrintBody_instructionWrapper__']").forEach(node => node.remove());
    const result = await extractors.extractStructured(1, recipeUrl, { variant: 'metadata' });
    expect(result.data.error).toBeUndefined();
    expect(result.data.item).toMatchObject({ title: 'Synthetic Loaf', itemId: recipeUrl, author: 'Fixture Baker' });
    for (const field of ['ingredients', 'instructions', 'beforeYouBegin', 'whyThisWorks']) {
      expect(result.data.item).not.toHaveProperty(field);
    }
  });

  it('projects an ingredient list without requiring omitted instructions', async () => {
    const { document, extractors } = await harness();
    document.querySelectorAll("[class*='instructions_instructionWrapper__'], [class*='recipePrintBody_instructionWrapper__']").forEach(node => node.remove());
    const result = await extractors.extractStructured(1, recipeUrl, { variant: 'ingredients' });
    expect(result.data.error).toBeUndefined();
    expect(result.data.item?.ingredients).toEqual(ingredientTexts);
    expect(result.data.item).not.toHaveProperty('instructions');
  });

  it.each([
    'https://foreign.example/recipes/9001-synthetic-loaf',
    'javascript:openRecipe()',
    'https://www.americastestkitchen.com/search?next=/recipes/9001-synthetic-loaf',
  ])('uses the current recipe URL when canonical identity is invalid: %s', async href => {
    const { document, extractors } = await harness();
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', href);
    const result = await extractors.extractStructured(1, recipeUrl);
    expect(result.data.error).toBeUndefined();
    expect(result.data.item).toMatchObject({ itemId: recipeUrl, recipeId: '9001' });
  });

  it('reports a challenge page at a valid recipe URL as missing core content', async () => {
    const { extractors } = await harness('<html><body><h1>Access check</h1></body></html>');
    const result = await extractors.extractStructured(1, recipeUrl);
    expect(result.data.error).toMatch(/Required fields missing:/);
    expect(result.data.item).toBeUndefined();
  });
});
