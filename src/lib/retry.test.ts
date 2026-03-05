import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { baseDelay: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(withRetry(fn, { maxRetries: 2, baseDelay: 1 })).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("respects retryOn filter", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("auth error"));
    await expect(
      withRetry(fn, { maxRetries: 3, baseDelay: 1, retryOn: (err) => !(err instanceof Error && err.message.includes("auth")) })
    ).rejects.toThrow("auth error");
    expect(fn).toHaveBeenCalledTimes(1); // No retries
  });

  it("uses exponential backoff", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");
    const start = Date.now();
    await withRetry(fn, { baseDelay: 50, maxRetries: 1 });
    const elapsed = Date.now() - start;
    // Should have waited at least 50ms (baseDelay * 2^0)
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("works with zero retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(withRetry(fn, { maxRetries: 0 })).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("defaults to 3 retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(withRetry(fn, { baseDelay: 1 })).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });
});
