/** FetchMode mirrors etzhayyim:crawl-engine/types.fetch-mode enum. */
export enum FetchMode {
  Standard = 0,
  Render = 1,
  Auto = 2,
}

/** CrawlPageRequest mirrors etzhayyim:crawl-engine/types.crawl-page-request. */
export interface CrawlPageRequest {
  url: string;
  userAgent?: string;
  'fetchMode': FetchMode;
  maxBodyBytes?: number;
  timeoutMs?: number;
  'fetchImages': boolean;
  maxImages?: number;
  'computeFingerprints': boolean;
  'classifyTopics': boolean;
  laserLabelsJson?: string;
  laserTopK?: number;
}

/** CrawlPageResult mirrors etzhayyim:crawl-engine/types.crawl-page-result. */
export interface CrawlPageResult {
  url: string;
  'finalUrl': string;
  'httpStatus': number;
  title?: string;
  textContent?: string;
  links: string[];
  'linkCount': number;
  'sizeBytes': number;
  'headersJson': string;
  'ogpJson': string;
  'metadataJson': string;
  'imageUrls': string[];
  'imageBinaries': ImageBinary[];
  contentHash?: string;
  simHash?: string;
  'antiBotDetected': boolean;
  classificationsJson?: string;
  'wasRendered': boolean;
  'elapsedMs': number;
}

/** ImageBinary mirrors etzhayyim:crawl-engine/types.image-binary. */
export interface ImageBinary {
  url: string;
  'mimeType': string;
  sha256: string;
  'dataBase64': string;
  'sizeBytes': number;
}

/** RobotsRequest mirrors etzhayyim:crawl-engine/types.robots-request. */
export interface RobotsRequest {
  host: string;
  'userAgent': string;
}

/** RobotsResult mirrors etzhayyim:crawl-engine/types.robots-result. */
export interface RobotsResult {
  loaded: boolean;
  'allowAll': boolean;
  'disallowAll': boolean;
  'rulesJson': string;
  'crawlDelaySec': number;
}

/** CrawlEngineError mirrors etzhayyim:crawl-engine/types.crawl-engine-error. */
export interface CrawlEngineError {
  url: string;
  code: string;
  message: string;
}

/** FetchImageRequest is the JSON request body for FetchImage. */
export interface FetchImageRequest {
  url: string;
  'userAgent': string;
}
