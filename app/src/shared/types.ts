/**
 * Mirror of the Pydantic models in `sidecar/pdf_parser_sidecar/models.py`.
 *
 * Keep these definitions in sync by hand. A future improvement is to generate
 * them from the FastAPI OpenAPI schema at build time.
 */

export type DocumentStatus = "pending" | "processing" | "done" | "failed" | "skipped";
export type DocumentSort = "processed_desc" | "processed_asc" | "name_asc" | "pages_desc";
export type JobState = "queued" | "running" | "done" | "cancelled" | "failed";
export type SearchRank = "relevance" | "recent";
export type FailureCategory =
  | "ocr_missing_dependency"
  | "file_locked"
  | "pdf_parse_error"
  | "model_unavailable"
  | "filesystem_error"
  | "unknown";

export interface HealthResponse {
  status: "ok";
  version: string;
}

export interface ProcessRequest {
  input_folder: string;
  output_folder: string;
  force: boolean;
  rename_with_llm: boolean;
}

export interface ProcessAccepted {
  job_id: string;
  file_count: number;
}

export interface RetryAccepted {
  job_id: string;
}

export interface DocumentRow {
  id: number;
  content_hash: string;
  original_path: string;
  output_path: string | null;
  original_name: string;
  ai_name: string | null;
  page_count: number | null;
  processed_at: string | null;
  status: DocumentStatus;
  error: string | null;
  error_category: FailureCategory | null;
  retryable: boolean;
  retry_count: number;
  title: string | null;
  author: string | null;
  source_created_at: string | null;
}

export interface DocumentList {
  items: DocumentRow[];
  total: number;
}

export interface DocumentListOptions {
  limit?: number;
  offset?: number;
  status?: DocumentStatus;
  sort?: DocumentSort;
}

export interface SearchHit {
  document_id: number;
  original_name: string;
  ai_name: string | null;
  output_path: string | null;
  snippet: string;
  score: number;
  processed_at: string | null;
  title: string | null;
  author: string | null;
  source_created_at: string | null;
}

export interface SearchResponse {
  query: string;
  total: number;
  limit: number;
  offset: number;
  hits: SearchHit[];
  rank: SearchRank;
}

export interface SearchOptions {
  status?: DocumentStatus;
  name?: string;
  processed_after?: string;
  processed_before?: string;
  rank?: SearchRank;
}

export interface JobProgress {
  job_id: string;
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  current_file: string | null;
  state: JobState;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobList {
  items: JobProgress[];
}

export interface SettingsModel {
  input_folder: string | null;
  output_folder: string | null;
  model: string;
  auto_update: boolean;
  ollama_url: string;
  rename_with_llm: boolean;
  ocr_language: string;
  max_concurrent_jobs: number;
}

export interface OllamaStatus {
  available: boolean;
  url: string;
}

export interface IndexHealth {
  documents_total: number;
  indexed_total: number;
  done_total: number;
  missing_in_fts: number;
  orphaned_fts_rows: number;
}

export interface AgentAskRequest {
  question: string;
}

export interface AgentCitation {
  document_id: number;
  original_name: string;
  ai_name: string | null;
  output_path: string | null;
  passage: string;
}

export interface AgentAnswer {
  question: string;
  answer: string;
  queries: string[];
  citations: AgentCitation[];
  model_available: boolean;
}

export interface OcrToolsStatus {
  has_ocrmypdf_package: boolean;
  tesseract_available: boolean;
  ghostscript_available: boolean;
  real_ocr_ready: boolean;
}

export interface HealthDetails {
  status: "ok";
  version: string;
  ollama_available: boolean;
  active_jobs: number;
  recent_jobs: number;
  ocr: OcrToolsStatus;
}

export interface SidecarDiagnostics {
  running: boolean;
  command: string | null;
  startError: string | null;
  lastExit: { code: number | null; signal: string | null } | null;
  stderrTail: string[];
  logFile: string | null;
}

/**
 * Auto-update lifecycle, broadcast from the Electron main process to the
 * renderer. The renderer never talks to `electron-updater` directly.
 *
 *   idle       → updater disabled or no check in flight.
 *   checking   → a check is in flight against the configured feed.
 *   not-available → check completed; we are on the latest version.
 *   available  → a newer version exists; download is starting in the background.
 *   downloading → bytes are flowing; `percent` is 0..100.
 *   downloaded → new version is staged on disk; user can restart to install.
 *   error      → the last check or download failed (network, bad feed, etc.).
 */
export type UpdateStatusKind =
  | "idle"
  | "checking"
  | "not-available"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatus {
  kind: UpdateStatusKind;
  /** Version string for `available`, `downloading`, `downloaded`. */
  version?: string;
  /** 0..100 for `downloading`. */
  percent?: number;
  /** Bytes / second for `downloading`. */
  bytesPerSecond?: number;
  /** Human-readable message for `error`. */
  message?: string;
  /** Whether auto-update is currently enabled (opt-in by user). */
  enabled: boolean;
}

/** Surface exposed by `preload` on `window.api`. */
export interface ElectronApi {
  pickFolder: (kind: "input" | "output") => Promise<string | null>;
  openPath: (path: string) => Promise<void>;
  revealInFolder: (path: string) => Promise<void>;
  openAppDataFolder: () => Promise<void>;
  exportDiagnostics: () => Promise<string>;
  getSidecarDiagnostics: () => Promise<SidecarDiagnostics>;
  viewer: {
    loadPdf: (path: string) => Promise<string | null>;
    clear: () => Promise<void>;
  };
  updater: {
    /**
     * Enable or disable auto-update checks at runtime. Mirrors the user's
     * `auto_update` setting; the renderer should call this whenever the
     * setting is saved so the change takes effect without a restart.
     */
    setEnabled: (enabled: boolean) => Promise<void>;
    /** Trigger an immediate check (only effective when enabled). */
    checkNow: () => Promise<void>;
    /** Quit and install the staged update. No-op if nothing is downloaded. */
    quitAndInstall: () => Promise<void>;
    /**
     * Subscribe to status updates pushed from the main process. Returns an
     * unsubscribe function. The first event is delivered synchronously on
     * subscribe so the caller always sees the latest state.
     */
    onStatus: (cb: (status: UpdateStatus) => void) => () => void;
  };
  sidecar: {
    health: () => Promise<HealthResponse>;
    process: (req: ProcessRequest) => Promise<ProcessAccepted>;
    listJobs: () => Promise<JobList>;
    getJob: (id: string) => Promise<JobProgress>;
    cancelJob: (id: string) => Promise<{ cancelled: boolean }>;
    listDocuments: (options?: DocumentListOptions) => Promise<DocumentList>;
    listFailedDocuments: (limit?: number) => Promise<DocumentList>;
    retryDocument: (id: number) => Promise<RetryAccepted>;
    deleteDocument: (id: number) => Promise<{ deleted: boolean }>;
    search: (q: string, limit?: number, offset?: number, options?: SearchOptions) => Promise<SearchResponse>;
    getSettings: () => Promise<SettingsModel>;
    putSettings: (s: SettingsModel) => Promise<SettingsModel>;
    ollamaStatus: () => Promise<OllamaStatus>;
    healthDetails: () => Promise<HealthDetails>;
    getIndexHealth: () => Promise<IndexHealth>;
    rebuildIndex: () => Promise<{ rebuilt_rows: number }>;
    optimizeIndex: () => Promise<{ optimized: boolean }>;
    clearTempFiles: () => Promise<{ output_folder: string | null; cleared: number }>;
    retryFailedBatch: (limit?: number) => Promise<{
      queued: number;
      skipped_non_retryable: number;
      skipped_retry_limit: number;
      job_ids: string[];
    }>;
    agent: {
      ask: (question: string) => Promise<AgentAnswer>;
    };
  };
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}
