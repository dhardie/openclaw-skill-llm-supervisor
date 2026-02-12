"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onAgentStart = onAgentStart;
const state_1 = require("../state");
async function onAgentStart(ctx, event) {
    const state = (0, state_1.getState)(ctx);
    // Auto-recover to cloud after cooldown
    if (state.mode === "local" && (0, state_1.isCooldownOver)(state, ctx.config.cooldownMinutes ?? 30)) {
        (0, state_1.setState)(ctx, { mode: "cloud", since: Date.now() });
        await ctx.notify.all("✅ Cooldown elapsed — automatically switching back to **cloud LLM**.");
        ctx.log.info("[llm-supervisor] Auto-recovered to cloud mode after cooldown");
        event.agent.setLLMProfile("anthropic:default");
        return;
    }
    if (state.mode === "cloud") {
        // Explicitly ensure cloud provider
        event.agent.setLLMProfile("anthropic:default");
        ctx.log.info("[llm-supervisor] Agent started in cloud mode");
        return;
    }
    // Local mode
    const localModel = ctx.config.localModel;
    event.agent.setLLMProfile({
        provider: "ollama",
        model: localModel,
        baseUrl: "http://127.0.0.1:11434"
    });
    ctx.log.info(`[llm-supervisor] Agent started in local mode (${localModel})`);
}
