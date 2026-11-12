import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// JSDOM has no top layer. Focus containment and Escape are verified in Chromium.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
