"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onLLMError = onLLMError;
const state_1 = require("../state");
async function onLLMError(ctx, event) {
    const cfg = ctx.config;
    const state = (0, state_1.getState)(ctx);
    // Only react if we're currently on cloud
    if (state.mode !== "cloud")
        return;
    // Detect rate limit / quota / overload style errors
    const msg = (event.error?.message || "").toLowerCase();
    const code = (event.error?.code || "").toLowerCase();
    const RATE_LIMIT_PATTERNS = [
        "rate limit",
        "rate_limit",
        "quota",
        "429",
        "too many requests",
        "overloaded",
        "overload",
        "capacity",
        "throttl",
        "resource_exhausted",
        "server_busy",
        "service_unavailable",
        "503",
        "529",
    ];
    const isRateLimit = RATE_LIMIT_PATTERNS.some((p) => msg.includes(p) || code.includes(p));
    if (!isRateLimit)
        return;
    ctx.log.warn("[llm-supervisor] Cloud LLM rate limit detected");
    // Switch to local
    (0, state_1.setState)(ctx, {
        mode: "local",
        since: Date.now(),
        lastError: event.error?.message
    });
    // Notify users
    await ctx.notify.all(`⚠️ Cloud LLM rate limit detected.\n` +
        `Switched main agent to **local model (${cfg.localModel})**.\n` +
        `Chat is unaffected. Code actions will require confirmation.`);
    ctx.log.info("[llm-supervisor] Switched to local LLM");
}
