/**
 * Smoke tests for the shared IPC contract types. These guard against drift
 * between the renderer-facing types and the sidecar's Pydantic models — a
 * mismatch will surface as a TS compile error here.
 */
import { describe, it, expect } from "vitest";
import type {
  DocumentRow,
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
    };
    expect(h.snippet).toContain("[[");
  });
});
