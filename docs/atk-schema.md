# America's Test Kitchen recipe schema

Implemented October 31, 2026 from three private MHTML captures in the latest saved session, `2026-10-31_190017`. Captured scripts were never executed and no network resources were fetched. No browsing captures or original recipe prose are committed.

Version 2, added November 1, 2026, provides the explicitly named **full instructions** view for ingredients and the complete cooking method together. The existing cooking view retains the same combined fields.

## Supported content and views

`americastestkitchen.com` and its `www` hostname match recipe paths shaped like `/recipes/12345-recipe-name`. Pathname matching rejects search/article pages, query-string lookalikes and extra path segments. Coverage is the inspected RecipeV2 recipe layout, not every ATK page type.

| View | Saved fields |
| --- | --- |
| Full | Title, canonical URL, numeric recipe ID, author, complete time description, yield, rating and rating count, publication date, ingredients, preparation notes, numbered instructions and recipe explanation |
| full instructions | Recipe identity, time, yield, complete ingredient list with quantities, preparation notes and numbered instructions |
| cooking | Recipe identity, time, yield, ingredients, preparation notes and numbered instructions |
| ingredients | Recipe identity, yield and one ingredient list with original quantities |
| metadata | Recipe identity, author, time, yield, rating, rating count and publication date |

Full, full instructions and cooking require title, ingredients and instructions. The ingredients variant requires title and ingredients; metadata requires title. Optional fields remain empty when absent. A challenge page or a recipe with an entirely missing core section reports an extraction error. Presence checks cannot prove that a partly loaded section is complete.

## Observed structure and text handling

- Recipe headers use `RecipeHeader_headingH1__`; author is in `meta[name='author']`. The retained print header supplies a title fallback and publication date.
- `TimeAndYield_card__` contains time and yield. Time is kept verbatim, including resting and cooling qualifiers. Print information cards provide fallbacks; their positions use `:first-of-type` and `:nth-of-type(2)` because other element types precede them.
- Ingredients appear in desktop, tablet, mobile and print copies. Ordered selector fallbacks choose one complete matching list rather than combining all four. CSS module prefixes omit generated hashes. Ingredient quantities and inline text are retained without summarizing or deduplicating legitimate repeated ingredients.
- Normal `instructions_instructionWrapper__` and print `recipePrintBody_instructionWrapper__` wrap one method step and optional sibling heading. The opt-in `lineBreakBefore` field option inserts explicit boundaries before `li` and `p` elements on a detached clone. This preserves sibling headings, paragraphs and existing `<br>` breaks. Post-processing numbers steps in DOM order.
- Preparation notes and the recipe explanation retain complete saved paragraphs. Recommendation cards, cooking-class promotions, comments, ratings controls and account UI are outside the selected recipe content.
- `ratingCount` counts ratings, not discussion comments. Post-processing removes count punctuation and the publication label. Canonical recipe URLs lose queries, fragments and trailing slashes; invalid or missing canonical links fall back to the current recipe URL. Recipe IDs come from that normalized path.

`exclude` removes selected controls from detached text clones. No captured script runs and the original page DOM stays unchanged. Existing schemas keep their original text behavior unless they opt into `lineBreakBefore`.

## Verification

| Saved recipe | Ingredients | Instructions |
| --- | ---: | ---: |
| Whole-Wheat Rustic Loaf | 7 | 8 |
| Easy Sandwich Bread | 8 | 3 |
| No-Knead Rustic Loaf | 6 | 8 |

All three captures passed Full and every variant, retained original ingredient text and complete method text, populated every optional Full field, and left the source DOM unchanged. Isolating each captured print subtree also passed recipe extraction. This replay validates saved DOM selectors; it does not establish live installed-extension behavior.

`src/atk-extractors.test.ts` uses invented content with the observed structural patterns. Its 28 tests cover registration, routes, duplicate layouts, responsive/print fallbacks, full and projected views, rich text boundaries, saved Markdown, canonical fallback and missing-content failures. The full suite passed 174 tests across 12 files. `npm run typecheck` and `npm run build` passed. The exact full instructions option is checked for combined ingredients/method output, print fallback and missing-content validation.

Sandboxed npm validation exited with status 1 after its script banner, without compiler diagnostics. The original checks passed with scoped elevation, matching the documented temporary route. No shared configuration was changed.

## Remaining live verification

Reload the installed Page Save extension, open an already accessible ATK recipe, select full instructions and save it. Confirm one ingredient list, complete numbered steps, preparation notes, time and yield in the saved Markdown. Full, cooking, ingredients and metadata should appear alongside full instructions and Raw. Raw remains the default.

Search/listing pages, related editorial layouts, comments and ingredient-group headings for multipart recipes are unverified. The three captured bread recipes have no substantive ingredient group headings. Validate a multipart recipe capture before extending coverage to those groups.
