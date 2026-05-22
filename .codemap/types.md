# Types (generated 2026-05-22)

**Total types:** 42

## src/browser-extension-discovery.ts

### DetectedExtension (interface)

| Field | Type | Optional |
|-------|------|----------|
| `id` | `string` |  |
| `browser` | `Browser` |  |
| `profile` | `string` |  |
| `path` | `string` |  |
| `active` | `boolean` |  |
| | *...and 2 more fields* | |

### ExtensionPreferences (interface)

| Field | Type | Optional |
|-------|------|----------|
| `path` | `unknown` | ? |
| `disable_reasons` | `unknown` | ? |
| `active_permissions` | `{ api?: unknown }` | ? |
| `granted_permissions` | `{ api?: unknown }` | ? |

### BrowserPreferences (interface)

| Field | Type | Optional |
|-------|------|----------|
| `extensions` | `{` | ? |
| `settings` | `Record<string, ExtensionPreferences>` | ? |

**type** `Browser`

## src/cli.ts

### CliArgs (interface)

| Field | Type | Optional |
|-------|------|----------|
| `action` | `string` |  |
| `tab` | `string` | ? |
| `output` | `string` | ? |
| `domain` | `string` | ? |
| `maxPages` | `number` | ? |
| | *...and 14 more fields* | |

## src/install-launcher.ts

### InstallOptions (interface)

| Field | Type | Optional |
|-------|------|----------|
| `extensionIds` | `string[]` |  |
| `browsers` | `Browser[]` |  |
| `dryRun` | `boolean` | ? |

### RegistryTarget (interface)

| Field | Type | Optional |
|-------|------|----------|
| `key` | `string` |  |
| `view` | `'32' | '64'` |  |

### PosixManifestTarget (interface)

| Field | Type | Optional |
|-------|------|----------|
| `browser` | `Browser | 'chromium'` |  |
| `dir` | `string` |  |

**type** `CSharpOutputType`

## src/native-launcher.ts

### LauncherRequest (interface)

| Field | Type | Optional |
|-------|------|----------|
| `action` | `string` | ? |

### LauncherResponse (interface)

*(empty)*

## src/schema-suggest.ts

### DraftSchema (interface)

| Field | Type | Optional |
|-------|------|----------|
| `domain` | `string` |  |
| `version` | `string` |  |
| `status` | `string` |  |
| `description` | `string` |  |
| `pages` | `Record<string, {` |  |
| | *...and 5 more fields* | |

## src/session-writer.ts

### SessionInfo (interface)

| Field | Type | Optional |
|-------|------|----------|
| `dir` | `string` |  |
| `reducedDir` | `string` |  |
| `rawDir` | `string` |  |
| `timestamp` | `string` |  |

### WrittenPageFiles (interface)

| Field | Type | Optional |
|-------|------|----------|
| `file` | `string` | ? |
| `reducedFile` | `string` | ? |
| `rawFile` | `string` | ? |

### SymbolTable (interface)

| Field | Type | Optional |
|-------|------|----------|
| `entries` | `Map<string, string>` |  |
| `reverse` | `Map<string, string>` |  |

### AccumulatingSession (interface)

| Field | Type | Optional |
|-------|------|----------|
| `info` | `SessionInfo` |  |
| `pages` | `ExtractionResult[]` |  |
| `startedAt` | `string` |  |

## src/types.ts

### WsRequest (interface)

| Field | Type | Optional |
|-------|------|----------|
| `id` | `string` |  |
| `action` | `'list-tabs' | 'save-page' | 'get-text' | 'get-structured' | 'get-structured-batch' | 'get-structured-paginated' | 'probe-dom' | 'probe-result-html' | 'batch-urls' | 'get-youtube-html'` |  |
| `tabId` | `number` | ? |
| `tabIds` | `number[]` | ? |
| `maxPages` | `number` | ? |
| | *...and 4 more fields* | |

### ExtractOptions (interface)

| Field | Type | Optional |
|-------|------|----------|
| `variant` | `string` | ? |
| `forceRaw` | `boolean` | ? |

### TabInfo (interface)

| Field | Type | Optional |
|-------|------|----------|
| `tabId` | `number` |  |
| `title` | `string` |  |
| `url` | `string` |  |
| `active` | `boolean` |  |
| `windowId` | `number` |  |

### TabListResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `tabs` | `TabInfo[]` |  |

### SavePageResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `data` | `string` |  |
| `title` | `string` |  |
| `url` | `string` |  |

### GetTextResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `text` | `string` |  |
| `title` | `string` |  |
| `url` | `string` |  |

### StructuredResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `type` | `'structured'` |  |
| `domain` | `string` |  |
| `pageType` | `string` |  |
| `schemaVersion` | `string` |  |
| `variant` | `string` | ? |
| | *...and 8 more fields* | |

### RawResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `type` | `'raw'` |  |
| `domain` | `string` |  |
| `url` | `string` |  |
| `title` | `string` |  |
| `tabId` | `number` | ? |
| | *...and 4 more fields* | |

### ErrorResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `type` | `'error'` |  |
| `tabId` | `number` |  |
| `error` | `string` |  |

### YoutubeHtmlResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `type` | `'youtube-html'` |  |
| `url` | `string` |  |
| `title` | `string` |  |
| `html` | `string` |  |

### BatchResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `results` | `ExtractionResult[]` |  |
| `count` | `number` |  |

### WsResponseSuccess (interface)

| Field | Type | Optional |
|-------|------|----------|
| `id` | `string` |  |
| `result` | `TabListResult | SavePageResult | GetTextResult | StructuredResult | RawResult | BatchResult | DomProbeResult | YoutubeHtmlResult` |  |

### WsResponseError (interface)

| Field | Type | Optional |
|-------|------|----------|
| `id` | `string` |  |
| `error` | `string` |  |

### CliCommand (interface)

| Field | Type | Optional |
|-------|------|----------|
| `action` | `'serve' | 'tabs' | 'save' | 'text' | 'extract' | 'extract-all'` |  |
| `tab` | `string` | ? |
| `domain` | `string` | ? |
| `output` | `string` | ? |

### FieldConfidence (interface)

| Field | Type | Optional |
|-------|------|----------|
| `field` | `string` |  |
| `total` | `number` |  |
| `populated` | `number` |  |
| `rate` | `number` |  |

### PageConfidence (interface)

| Field | Type | Optional |
|-------|------|----------|
| `domain` | `string` |  |
| `pageType` | `string` |  |
| `fields` | `FieldConfidence[]` |  |
| `overallRate` | `number` |  |

### DomProbeCandidate (interface)

| Field | Type | Optional |
|-------|------|----------|
| `selector` | `string` |  |
| `count` | `number` |  |
| `sampleFields` | `{ name: string` |  |
| `selector` | `string` |  |
| `type` | `'text' | 'attribute'` |  |
| | *...and 1 more fields* | |

### DomProbeResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `url` | `string` |  |
| `domain` | `string` |  |
| `candidates` | `DomProbeCandidate[]` |  |

### WatchConfig (interface)

| Field | Type | Optional |
|-------|------|----------|
| `id` | `string` |  |
| `url` | `string` |  |
| `fields` | `string[]` | ? |
| `createdAt` | `string` |  |

### DiffChange (interface)

| Field | Type | Optional |
|-------|------|----------|
| `field` | `string` |  |
| `prev` | `unknown` |  |
| `curr` | `unknown` |  |

### DiffResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `added` | `Record<string, unknown>[]` |  |
| `removed` | `Record<string, unknown>[]` |  |
| `changed` | `{ item: Record<string, unknown>` |  |
| `changes` | `DiffChange[] }[]` |  |
| `unchanged` | `number` |  |

**type** `ExtractionResult`

**type** `WsResponse`

## src/ws-handler.ts

### PendingRequest (interface)

| Field | Type | Optional |
|-------|------|----------|
| `resolve` | `(value: WsResponse) => void` |  |
| `timeout` | `ReturnType<typeof setTimeout>` |  |

## src/youtube-extractor.ts

### YoutubeResult (interface)

| Field | Type | Optional |
|-------|------|----------|
| `type` | `'youtube'` |  |
| `videoId` | `string` |  |
| `title` | `string` |  |
| `channel` | `string` |  |
| `url` | `string` |  |
| | *...and 3 more fields* | |

### CaptionTrack (interface)

| Field | Type | Optional |
|-------|------|----------|
| `baseUrl` | `string` |  |
| `languageCode` | `string` |  |
| `kind` | `string` | ? |
| `name` | `{ simpleText?: string }` | ? |

<!-- Generated by claude-code-map at 2026-05-22T23:38:55.417Z -->