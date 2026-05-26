/**
 * Smoke tests for the shared IPC contract types. These guard against drift
 * between the renderer-facing types and the sidecar's Pydantic models — a
 * mismatch will surface as a TS compile error here.
 */
import { describe, it, expect } from "vitest";
import type {
  AgentAnswer,
  AgentAskRequest,
  AgentCitation,
  DocumentRow,
  ElectronApi,
  FeedbackRequest,
  FeedbackResult,
  HealthDetails,
  JobProgress,
  ProcessRequest,
  SearchHit,
  SettingsModel,
  SidecarDiagnostics,
  UpdateStatus,
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
      original_path: "C:/in/x.pdf",
      ai_name: "ocr_x",
      output_path: null,
      snippet: "…invoice [[number]] 42…",
      score: 1.0,
      page_number: 1,
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

  it("FeedbackRequest and FeedbackResult have the expected shapes", () => {
    const req: FeedbackRequest = {
      title: "Add dark mode",
      body: "It would be great to have a dark mode option.",
      contact: "user@example.com",
    };
    expect(req.title).toBe("Add dark mode");

    const resultOk: FeedbackResult = { success: true, issueUrl: "https://github.com/x/y/issues/1" };
    expect(resultOk.success).toBe(true);

    const resultErr: FeedbackResult = { success: false, error: "API error" };
    expect(resultErr.error).toBe("API error");
  });

  it("ElectronApi exposes submitFeedback", () => {
    const api: Pick<ElectronApi, "submitFeedback"> = {
      submitFeedback: async () => ({ success: true }),
    };
    expect(api.submitFeedback).toBeTypeOf("function");
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
      agent: {
        ask: async (question: string) => ({
          question,
          answer: "stub",
          queries: [question],
          citations: [],
          model_available: true,
        }),
      },
    };
    expect(sidecar.retryFailedBatch).toBeTypeOf("function");
    expect(sidecar.agent.ask).toBeTypeOf("function");
  });

  it("SidecarDiagnostics carries the fields the renderer surfaces on failure", () => {
    const diag: SidecarDiagnostics = {
      running: false,
      command: "python -m pdf_parser_sidecar",
      startError: "Timed out waiting for sidecar port handshake",
      lastExit: { code: 1, signal: null },
      stderrTail: ["[sidecar] ModuleNotFoundError: No module named 'pdf_parser_sidecar'"],
      logFile: "C:/Users/x/AppData/Roaming/pdf-parser/logs/sidecar.log",
    };
    expect(diag.stderrTail.length).toBeGreaterThan(0);
    expect(diag.lastExit?.code).toBe(1);
  });

  it("UpdateStatus covers the full auto-update lifecycle", () => {
    const states: UpdateStatus[] = [
      { kind: "idle", enabled: false },
      { kind: "checking", enabled: true },
      { kind: "not-available", enabled: true, version: "0.1.0" },
      { kind: "available", enabled: true, version: "0.2.0" },
      { kind: "downloading", enabled: true, version: "0.2.0", percent: 42, bytesPerSecond: 1024 },
      { kind: "downloaded", enabled: true, version: "0.2.0" },
      { kind: "error", enabled: true, message: "ENOTFOUND" },
    ];
    expect(states.length).toBe(7);
    expect(states.every((s) => typeof s.enabled === "boolean")).toBe(true);
  });

  it("ElectronApi exposes the updater surface (setEnabled / checkNow / quitAndInstall / onStatus)", () => {
    const updater: ElectronApi["updater"] = {
      setEnabled: async () => undefined,
      checkNow: async () => undefined,
      quitAndInstall: async () => undefined,
      onStatus: () => () => undefined,
    };
    expect(updater.setEnabled).toBeTypeOf("function");
    expect(updater.onStatus).toBeTypeOf("function");
  });

  it("AgentAskRequest, AgentCitation, and AgentAnswer define the agent contract", () => {
    const req: AgentAskRequest = { question: "What is the invoice total?" };
    const citation: AgentCitation = {
      document_id: 7,
      original_name: "invoice.pdf",
      ai_name: "Invoice 2024 Acme",
      output_path: "C:/out/invoice.pdf",
      passage: "…total $1,234 due March 2024…",
    };
    const answer: AgentAnswer = {
      question: req.question,
      answer: "The total is $1,234.",
      queries: ["invoice", "total"],
      citations: [citation],
      model_available: true,
    };
    expect(answer.citations[0].document_id).toBe(7);
    expect(answer.queries.length).toBeGreaterThan(0);
    expect(typeof answer.model_available).toBe("boolean");
  });
});
