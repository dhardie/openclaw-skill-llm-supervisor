import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Helpers: mock SDK objects ──────────────────────────────────────

function makeCtx(overrides = {}) {
  const store = {};
  return {
    log: { info() {}, warn() {}, error() {} },
    config: {
      localModel: "qwen2.5:7b",
      requireConfirmationForCode: true,
      confirmationPhrase: "CONFIRM LOCAL",
      cooldownMinutes: 30,
      ...overrides,
    },
    state: {
      get(k) { return store[k]; },
      set(k, v) { store[k] = v; },
    },
    notify: { all: async () => {} },
    _store: store,
  };
}

// ── Import dist modules ────────────────────────────────────────────

const { onLLMError } = await import("../dist/hooks/onLLMError.js");
const { beforeTaskExecute } = await import("../dist/hooks/beforeTaskExecute.js");
const { getState } = await import("../dist/state.js");

// ── Tests ──────────────────────────────────────────────────────────

describe("rate-limit detection", () => {
  const variants = [
    "rate limit exceeded",
    "Rate_limit_error",
    "You have exceeded your quota",
    "429 Too Many Requests",
    "too many requests",
    "The server is overloaded",
    "overload",
    "resource_exhausted",
    "503 Service Unavailable",
    "Request throttled",
    "capacity exceeded",
    "server_busy",
  ];

  for (const msg of variants) {
    it(`detects: "${msg}"`, async () => {
      const ctx = makeCtx();
      // Ensure cloud mode
      ctx.state.set("llm-supervisor:state", { mode: "cloud", since: Date.now() });
      await onLLMError(ctx, { error: { message: msg } });
      const state = ctx.state.get("llm-supervisor:state");
      assert.equal(state.mode, "local", `Should switch to local for: ${msg}`);
    });
  }

  it("detects via error code field", async () => {
    const ctx = makeCtx();
    ctx.state.set("llm-supervisor:state", { mode: "cloud", since: Date.now() });
    await onLLMError(ctx, { error: { code: "rate_limit", message: "" } });
    assert.equal(ctx.state.get("llm-supervisor:state").mode, "local");
  });

  it("ignores non-rate-limit errors", async () => {
    const ctx = makeCtx();
    ctx.state.set("llm-supervisor:state", { mode: "cloud", since: Date.now() });
    await onLLMError(ctx, { error: { message: "some random error" } });
    assert.equal(ctx.state.get("llm-supervisor:state").mode, "cloud");
  });

  it("ignores errors when already in local mode", async () => {
    const ctx = makeCtx();
    ctx.state.set("llm-supervisor:state", { mode: "local", since: Date.now() });
    await onLLMError(ctx, { error: { message: "rate limit" } });
    // should stay local, not re-trigger
    assert.equal(ctx.state.get("llm-supervisor:state").mode, "local");
  });
});

describe("state transition cloud → local", () => {
  it("switches and records lastError", async () => {
    const ctx = makeCtx();
    ctx.state.set("llm-supervisor:state", { mode: "cloud", since: Date.now() });
    await onLLMError(ctx, { error: { message: "429 Too Many Requests" } });
    const state = ctx.state.get("llm-supervisor:state");
    assert.equal(state.mode, "local");
    assert.equal(state.lastError, "429 Too Many Requests");
    assert.ok(state.since > 0);
  });
});

describe("confirmation guard", () => {
  it("blocks code task without confirmation", async () => {
    const ctx = makeCtx();
    ctx.state.set("llm-supervisor:state", { mode: "local", since: Date.now() });
    let blocked = false;
    const event = {
      task: { intent: "write_code" },
      context: { lastUserMessage: "please write a function" },
      block(reason) { blocked = reason; },
    };
    await beforeTaskExecute(ctx, event);
    assert.ok(blocked, "Should have blocked");
    assert.ok(blocked.includes("CONFIRM LOCAL"));
  });

  it("allows code task with confirmation phrase", async () => {
    const ctx = makeCtx();
    ctx.state.set("llm-supervisor:state", { mode: "local", since: Date.now() });
    let blocked = false;
    const event = {
      task: { intent: "edit_file" },
      context: { lastUserMessage: "yes CONFIRM LOCAL please" },
      block(reason) { blocked = reason; },
    };
    await beforeTaskExecute(ctx, event);
    assert.equal(blocked, false, "Should NOT have blocked");
  });

  it("skips guard in cloud mode", async () => {
    const ctx = makeCtx();
    ctx.state.set("llm-supervisor:state", { mode: "cloud", since: Date.now() });
    let blocked = false;
    const event = {
      task: { intent: "write_code" },
      context: { lastUserMessage: "" },
      block(reason) { blocked = reason; },
    };
    await beforeTaskExecute(ctx, event);
    assert.equal(blocked, false);
  });

  it("skips guard when requireConfirmationForCode is false", async () => {
    const ctx = makeCtx({ requireConfirmationForCode: false });
    ctx.state.set("llm-supervisor:state", { mode: "local", since: Date.now() });
    let blocked = false;
    const event = {
      task: { intent: "write_code" },
      context: { lastUserMessage: "" },
      block(reason) { blocked = reason; },
    };
    await beforeTaskExecute(ctx, event);
    assert.equal(blocked, false);
  });

  it("uses default phrase when config.confirmationPhrase is undefined", async () => {
    const ctx = makeCtx({ confirmationPhrase: undefined });
    ctx.state.set("llm-supervisor:state", { mode: "local", since: Date.now() });
    let blocked = false;
    const event = {
      task: { intent: "create_file" },
      context: { lastUserMessage: "do it" },
      block(reason) { blocked = reason; },
    };
    await beforeTaskExecute(ctx, event);
    assert.ok(blocked);
    assert.ok(blocked.includes("CONFIRM LOCAL"));
  });
});
