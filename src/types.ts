// WebSocket protocol messages

export interface WsRequest {
  id: string;
  action: 'list-tabs' | 'save-page' | 'get-text' | 'get-structured' | 'get-structured-batch' | 'get-structured-paginated';
  tabId?: number;
  tabIds?: number[];
  maxPages?: number;
}

export interface TabInfo {
  tabId: number;
  title: string;
  url: string;
  active: boolean;
  windowId: number;
}

export interface TabListResult {
  tabs: TabInfo[];
}

export interface SavePageResult {
  data: string; // base64 MHTML
  title: string;
  url: string;
}

export interface GetTextResult {
  text: string;
  title: string;
  url: string;
}

// --- Structured extraction types ---

export interface StructuredResult {
  type: 'structured';
  domain: string;
  pageType: string;
  schemaVersion: string;
  url: string;
  title: string;
  tabId?: number;
  data: {
    items?: Record<string, unknown>[];
    item?: Record<string, unknown>;
    count?: number;
    error?: string;
  };
}

export interface RawResult {
  type: 'raw';
  domain: string;
  url: string;
  title: string;
  tabId?: number;
  text: string;
}

export interface ErrorResult {
  type: 'error';
  tabId: number;
  error: string;
}

export type ExtractionResult = StructuredResult | RawResult | ErrorResult;

export interface BatchResult {
  results: ExtractionResult[];
  count: number;
}

// --- Response types ---

export interface WsResponseSuccess {
  id: string;
  result: TabListResult | SavePageResult | GetTextResult | StructuredResult | RawResult | BatchResult;
}

export interface WsResponseError {
  id: string;
  error: string;
}

export type WsResponse = WsResponseSuccess | WsResponseError;

export interface CliCommand {
  action: 'serve' | 'tabs' | 'save' | 'text' | 'extract' | 'extract-all';
  tab?: string;
  domain?: string;
  output?: string;
}

// --- Confidence scoring types ---

export interface FieldConfidence {
  field: string;
  total: number;
  populated: number;
  rate: number;
}

export interface PageConfidence {
  domain: string;
  pageType: string;
  fields: FieldConfidence[];
  overallRate: number;
}

export const PORT = 7224;
export const SAVE_DIR = 'C:\\Users\\somet\\Documents\\saved-pages';
