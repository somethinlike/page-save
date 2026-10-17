# Genius extraction schema

## Result

Page Save supports Genius album track lists and song pages using its domain-schema system. The implementation was grounded in eleven user-saved MHTML captures: one album and ten songs. Offline replay extracted ten ordered album rows, paired each with its corresponding song metadata, and exercised Full plus all three variants on every capture. Captured scripts were never executed and replay made no network requests.

The installed extension has not been reloaded or tested live. The user prohibited computer-use during this task.

## Views

| View | Album page | Song page |
| --- | --- | --- |
| Raw | Existing untouched MHTML capture | Existing untouched MHTML capture |
| Full | Ordered tracks, artist/album context, canonical links and available release date | Identity, track number, album/artist links, song ID, available credits and every lyric block |
| playlist | Track number, title, artist, album and canonical song link | The same compact fields for one song |
| metadata | Full metadata without lyric text | Full metadata without lyric text |
| lyrics | Ordered tracks with identity context | Lyrics with title, artist and album context |

Raw remains the default. Album extraction does not visit linked song pages, create playlists, align lyrics or publish data.

## Observed layouts and fields

Albums use legacy `.chart_row` markup. Track number, title and song link come from the same row. Artist, album, album URL and release-date context come from the page header. Canonical song URLs serve as `itemId` values, so session deduplication distinguishes different songs with the same title.

Songs use React class prefixes such as `SongHeader-desktop__Title-`, `SongHeader-desktop__CreditList-` and `PrimaryAlbum__Title-`. Generated suffixes are omitted. The artist selector excludes nested producer-credit lists. Album title comes from the header credit; album URL comes from the sidebar. This avoids removing meaningful years from actual album titles.

All ten song captures contain numeric Genius IDs in `twitter:app:url:iphone` metadata. Only two contain song-info credit blocks, so credits remain optional. Labels and values stay together in each credit block; the schema does not assume the first block always represents a release date.

Lyrics come from every `[data-lyrics-container='true']` block in document order. Selection headers, hidden/ARIA-hidden content, scripts, styles and templates are removed from a detached clone. Explicit `<br>` tags become newlines; empty blocks are discarded. Verse markers and lyric text are retained without truncation. Source DOM is unchanged.

## Extraction options

- `urlPathPattern` optionally matches an anchored pathname instead of searching the whole URL. Existing schemas keep their matching behavior.
- Field `scope: "page"` adds page context to repeating rows.
- Text-field `exclude` removes interface descendants from a clone while retaining explicit line breaks.
- `requiredFields` makes missing core content an extraction error. Requirements are limited to fields retained by the selected variant, so metadata does not require lyrics.

These options are documented in `SCHEMA-CONVENTIONS.md` and the schema template. Source JSON, extension JSON, manifest registration and built-in fallback are synchronized.

## Verification

Regression tests use synthetic HTML and a real DOM/CSS parser. They cover routing, registration parity, album order and link pairing, session deduplication, nested credits, multiple lyric blocks, line breaks, hidden interface removal, unchanged source DOM, variants, required-field failures and existing field/fallback behavior. Titles ending in “Lyrics” and album titles ending in a year are preserved.

```powershell
npm test
npm run typecheck
npm run build
```

Real captures remain outside the repository. Validation summaries report metadata and counts without placing lyric text in tests or public documentation.

The full suite passed 146 tests across eleven files, including 34 Genius regressions. TypeScript checks and the production build passed. The skill workflow passed the skill-creator validator. Online npm audit reported 15 existing dependency advisories; every reported package version matches the original lockfile, so none of those findings was introduced by the new test-only DOM parser. Remediation is recorded separately in `ROADMAP.md`.

## Limits and next diagnostic step

Coverage is limited to the inspected legacy album and React song layouts. Artist, search, translated-song and other routes are unsupported unless they match the documented shapes and selectors. Optional content cannot be recovered when absent. Offline DOM parsing does not establish live rendering or lyric completeness.

**Suggested next diagnostic step:** Reload Page Save when browser interaction is convenient, then save one Genius album using playlist and one song using Full. This establishes that the installed extension loads the new registry and produces the expected fields live.
