// WebSocket protocol messages

export interface WsRequest {
  id: string;
  action: 'list-tabs' | 'save-page' | 'get-text';
  tabId?: number;
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

export interface WsResponseSuccess {
  id: string;
  result: TabListResult | SavePageResult | GetTextResult;
}

export interface WsResponseError {
  id: string;
  error: string;
}

export type WsResponse = WsResponseSuccess | WsResponseError;

export interface CliCommand {
  action: 'serve' | 'tabs' | 'save' | 'text';
  tab?: string;
  output?: string;
}

export const PORT = 7224;
export const SAVE_DIR = 'C:\\Users\\somet\\Documents\\saved-pages';
