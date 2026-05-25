/**
 * Mirror of the Pydantic models in `sidecar/pdf_parser_sidecar/models.py`.
 *
 * Keep these definitions in sync by hand. A future improvement is to generate
 * them from the FastAPI OpenAPI schema at build time.
 */

export type DocumentStatus = "pending" | "processing" | "done" | "failed" | "skipped";
export type DocumentSort = "processed_desc" | "processed_asc" | "name_asc" | "pages_desc";
export type JobState = "queued" | "running" | "done" | "cancelled" | "failed";

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
}

export interface SearchResponse {
  query: string;
  total: number;
  limit: number;
  offset: number;
  hits: SearchHit[];
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

/** Surface exposed by `preload` on `window.api`. */
export interface ElectronApi {
  pickFolder: (kind: "input" | "output") => Promise<string | null>;
  openPath: (path: string) => Promise<void>;
  revealInFolder: (path: string) => Promise<void>;
  openAppDataFolder: () => Promise<void>;
  viewer: {
    loadPdf: (path: string) => Promise<string | null>;
    clear: () => Promise<void>;
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
    search: (q: string, limit?: number, offset?: number) => Promise<SearchResponse>;
    getSettings: () => Promise<SettingsModel>;
    putSettings: (s: SettingsModel) => Promise<SettingsModel>;
    ollamaStatus: () => Promise<OllamaStatus>;
  };
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}
