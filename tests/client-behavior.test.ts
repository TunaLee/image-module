import { describe, expect, it, vi } from "vitest";

import {
  replacePreviewObjectUrl,
  sessionResponseAction,
} from "../components/client-behavior";

describe("sessionResponseAction", () => {
  it("redirects to login only for an unauthorized response", () => {
    expect(sessionResponseAction(401)).toBe("redirect-login");
    expect(sessionResponseAction(500)).toBe("show-error");
    expect(sessionResponseAction(503)).toBe("show-error");
  });

  it("accepts a successful session response", () => {
    expect(sessionResponseAction(200)).toBe("accept");
  });
});

describe("replacePreviewObjectUrl", () => {
  it("revokes and clears the stale preview when replacement fails", () => {
    const revoke = vi.fn();

    expect(replacePreviewObjectUrl("blob:old-photo", null, revoke)).toBeNull();
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:old-photo");
  });
});
