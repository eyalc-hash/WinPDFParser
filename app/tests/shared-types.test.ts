/**
 * Smoke tests for the shared IPC contract types. These guard against drift
 * between the renderer-facing types and the sidecar's Pydantic models — a
 * mismatch will surface as a TS compile error here.
 */
import { describe, it, expect } from "vitest";
import type {
  DocumentRow,
  ElectronApi,
  HealthDetails,
  JobProgress,
  ProcessRequest,
  SearchHit,
  SettingsModel,
} from "../src/shared/types";

describe("shared types contract", () => {
  it("ProcessRequest has the required fields", () => {
    const req: ProcessRequest = {
      input_folder: "C:/in",
      output_folder: "C:/out",
      force: false,
      rename_with_llm: true,
    };
    expect(req.input_folder).toBe("C:/in");
  });

  it("DocumentRow status is a discriminated union", () => {
    const valid: DocumentRow["status"][] = ["pending", "processing", "done", "failed", "skipped"];
    expect(valid.length).toBe(5);
  });

  it("JobProgress state is a discriminated union", () => {
    const valid: JobProgress["state"][] = ["queued", "running", "done", "cancelled", "failed"];
    expect(valid.length).toBe(5);
  });

  it("SettingsModel exposes the documented keys", () => {
    const s: SettingsModel = {
      input_folder: null,
      output_folder: null,
      model: "llama3.2:3b",
      auto_update: false,
      ollama_url: "http://127.0.0.1:11434",
      rename_with_llm: true,
      ocr_language: "eng",
      max_concurrent_jobs: 1,
    };
    expect(s.model).toMatch(/llama|qwen|mistral|phi/);
  });

  it("SearchHit snippet supports FTS5 markup", () => {
    const h: SearchHit = {
      document_id: 1,
      original_name: "x.pdf",
      ai_name: "ocr_x",
      output_path: null,
      snippet: "…invoice [[number]] 42…",
      score: 1.0,
      processed_at: null,
      title: null,
      author: null,
      source_created_at: null,
    };
    expect(h.snippet).toContain("[[");
  });

  it("DocumentRow carries failure and metadata fields", () => {
    const row: DocumentRow = {
      id: 1,
      content_hash: "h",
      original_path: "C:/in/a.pdf",
      output_path: null,
      original_name: "a.pdf",
      ai_name: null,
      page_count: null,
      processed_at: null,
      status: "failed",
      error: "boom",
      error_category: "unknown",
      retryable: true,
      retry_count: 1,
      title: null,
      author: null,
      source_created_at: null,
    };
    expect(row.retry_count).toBe(1);
  });

  it("SearchResponse exposes paging metadata", () => {
    const res: import("../src/shared/types").SearchResponse = {
      query: "invoice",
      total: 8,
      limit: 25,
      offset: 0,
      hits: [],
      rank: "relevance",
    };
    expect(res.total).toBeGreaterThanOrEqual(res.hits.length);
  });

  it("HealthDetails exposes OCR readiness and queue stats", () => {
    const details: HealthDetails = {
      status: "ok",
      version: "0.1.0",
      ollama_available: true,
      active_jobs: 1,
      recent_jobs: 12,
      ocr: {
        has_ocrmypdf_package: true,
        tesseract_available: true,
        ghostscript_available: true,
        real_ocr_ready: true,
      },
    };
    expect(details.ocr.real_ocr_ready).toBe(true);
  });

  it("ElectronApi sidecar exposes recovery and health-detail methods", () => {
    const sidecar: ElectronApi["sidecar"] = {
      health: async () => ({ status: "ok", version: "0.1.0" }),
      process: async () => ({ job_id: "job", file_count: 1 }),
      listJobs: async () => ({ items: [] }),
      getJob: async () => ({
        job_id: "job",
        total: 1,
        processed: 0,
        skipped: 0,
        failed: 0,
        current_file: null,
        state: "queued",
        started_at: null,
        finished_at: null,
      }),
      cancelJob: async () => ({ cancelled: true }),
      listDocuments: async () => ({ items: [], total: 0 }),
      listFailedDocuments: async () => ({ items: [], total: 0 }),
      retryDocument: async () => ({ job_id: "retry" }),
      deleteDocument: async () => ({ deleted: true }),
      search: async () => ({
        query: "q",
        total: 0,
        limit: 50,
        offset: 0,
        hits: [],
        rank: "relevance",
      }),
      getSettings: async () => ({
        input_folder: null,
        output_folder: null,
        model: "llama3.2:3b",
        auto_update: false,
        ollama_url: "http://127.0.0.1:11434",
        rename_with_llm: true,
        ocr_language: "eng",
        max_concurrent_jobs: 1,
      }),
      putSettings: async (s) => s,
      ollamaStatus: async () => ({ available: true, url: "http://127.0.0.1:11434" }),
      healthDetails: async () => ({
        status: "ok",
        version: "0.1.0",
        ollama_available: true,
        active_jobs: 0,
        recent_jobs: 0,
        ocr: {
          has_ocrmypdf_package: false,
          tesseract_available: false,
          ghostscript_available: false,
          real_ocr_ready: false,
        },
      }),
      getIndexHealth: async () => ({
        documents_total: 0,
        indexed_total: 0,
        done_total: 0,
        missing_in_fts: 0,
        orphaned_fts_rows: 0,
      }),
      rebuildIndex: async () => ({ rebuilt_rows: 0 }),
      optimizeIndex: async () => ({ optimized: true }),
      clearTempFiles: async () => ({ output_folder: null, cleared: 0 }),
      retryFailedBatch: async () => ({
        queued: 0,
        skipped_non_retryable: 0,
        skipped_retry_limit: 0,
        job_ids: [],
      }),
    };
    expect(sidecar.retryFailedBatch).toBeTypeOf("function");
  });
});
