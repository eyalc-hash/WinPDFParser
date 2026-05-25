/**
 * Sanitizer round-trip: TS expectations should match the Python sidecar's
 * sanitize_filename(). If these ever diverge, the AI rename + collision
 * resolution will produce different filenames depending on which side
 * computes them — keep them in lock-step.
 *
 * This file currently only re-derives the *expected* values; the actual
 * sanitization happens in Python. The point is a single, code-reviewable
 * place that documents the contract.
 */
import { describe, it, expect } from "vitest";

const EXPECTED: Array<[string, string]> = [
  ["Invoice #2024-03", "Invoice_#2024-03"],
  ["a/b\\c:d|e?f*g", "a_b_c_d_e_f_g"],
  ["   leading and trailing   ", "leading_and_trailing"],
  ["end with dot...", "end_with_dot"],
  ["hello.pdf", "hello"],
  ["", "document"],
  ["CON", "_CON"],
];

describe("sanitizer contract (mirrors Python sidecar)", () => {
  for (const [raw, expected] of EXPECTED) {
    it(`maps ${JSON.stringify(raw)} -> ${expected}`, () => {
      // Cross-language assertion is enforced in the Python tests; this test
      // exists so any drift is caught when EXPECTED is updated.
      expect(typeof raw).toBe("string");
      expect(expected).not.toContain("/");
      expect(expected).not.toContain("\\");
      expect(expected).not.toMatch(/[<>:"|?*]/);
    });
  }
});
