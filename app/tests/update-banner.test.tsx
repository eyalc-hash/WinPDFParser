import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "../src/renderer/components/UpdateBanner";
import type { ElectronApi, UpdateStatus } from "../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quitAndInstall = vi.fn<ElectronApi["updater"]["quitAndInstall"]>();

beforeEach(() => {
  quitAndInstall.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

async function renderWithStatus(status: UpdateStatus): Promise<Root> {
  window.api = {
    updater: {
      onStatus: (cb: (status: UpdateStatus) => void) => {
        cb(status);
        return () => undefined;
      },
      quitAndInstall,
    },
  } as unknown as ElectronApi;

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<UpdateBanner />);
  });
  return root;
}

describe("UpdateBanner", () => {
  it("starts the full installer flow when the downloaded update button is clicked", async () => {
    const root = await renderWithStatus({ kind: "downloaded", enabled: true, version: "1.2.3" });

    const button = document.querySelector("button");
    expect(button?.textContent).toBe("Install update v1.2.3");

    await act(async () => {
      button?.click();
    });

    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    expect(button?.textContent).toBe("Installing…");

    await act(async () => root.unmount());
  });
});
