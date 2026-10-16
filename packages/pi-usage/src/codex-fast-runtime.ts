import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  type CodexFastCapability,
  codexFastAvailability,
  codexFastIsEffective,
  codexFastStatusLabel,
  correctCodexFastMessageCost,
  isOfficialCodexModel,
  rewriteCodexFastPayload,
  UNKNOWN_CODEX_FAST_CAPABILITY,
} from "./codex-fast.js";
import { createCodexFastCatalog } from "./codex-fast-catalog.js";
import { isCodexSlot, verifiedCodexSlotRoute } from "./codex-slot-auth.js";
import { errorMessage } from "./core.js";
import {
  createOAuthCredentialCandidateReader,
  type OAuthCredentialCandidateReader,
  type StoredCredentialReader,
} from "./oauth-credential-source.js";
import { isStaleExtensionContextError } from "./query.js";
import type { UsageSettingsRuntime, UsageSettingsState } from "./settings.js";
import { safeStatuslineText } from "./statusline-display.js";
import type { PiModel } from "./types.js";
import { emphasizeFastDetails } from "./usage-emphasis.js";

const NO_FAST_REQUEST = Symbol("no-fast-request");
type PendingFastRequest = { fastRequested: boolean; model: PiModel; capability: CodexFastCapability };
type SlotTier = "priority" | "default";
const SLOT_FAST_ENTRY = "codex-fast";
const SLOT_FAST_WARNING =
  "Requests priority for subsequent calls in this session; actual support and speed are not guaranteed and usage/credits may increase.";

export const FAST_USAGE_WARNING = "Fast is about 1.5× faster and uses more of your plan allowance.";

export function registerCodexFastMode(
  pi: ExtensionAPI,
  settingsRuntime: UsageSettingsRuntime,
  refreshStatus: (ctx: ExtensionContext) => void,
  options: {
    registerSessionStart?: boolean;
    credentialReader?: StoredCredentialReader;
    candidateReader?: OAuthCredentialCandidateReader;
    timeoutMs?: number;
  } = {},
) {
  let sessionController = new AbortController();
  let generation = 0;
  const pendingFastRequests = new Map<string, PendingFastRequest>();
  let slotTier: SlotTier | undefined;
  const slotRequests = new Map<string, { requested: SlotTier; server?: string }>();

  const restoreSlotPreference = (ctx: ExtensionContext) => {
    slotTier = undefined;
    slotRequests.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (
        entry.type === "custom" &&
        entry.customType === SLOT_FAST_ENTRY &&
        isRecord(entry.data) &&
        typeof entry.data.enabled === "boolean"
      ) {
        slotTier = entry.data.enabled ? "priority" : "default";
      }
    }
  };

  const setSlotPreference = (ctx: ExtensionCommandContext, enabled: boolean, signal?: AbortSignal): boolean => {
    if (signal?.aborted || sessionController.signal.aborted) return false;
    if (!trustedCodexSlot(ctx.model)) {
      ctx.ui.notify("Numbered Codex Fast requires a verified local account proxy route.", "warning");
      return false;
    }
    // Retain the old helper's custom-entry format, so existing branches/resumes keep their intent.
    pi.appendEntry(SLOT_FAST_ENTRY, { enabled });
    slotTier = enabled ? "priority" : "default";
    refreshStatus(ctx);
    ctx.ui.notify(`Fast request ${enabled ? "on" : "off"} for numbered Codex accounts. ${SLOT_FAST_WARNING}`, "info");
    return true;
  };

  pi.registerCommand("codex-fast", {
    description: "Toggle Codex Fast, or explicitly set on/off or inspect status",
    getArgumentCompletions: (prefix) =>
      ["on", "off", "status"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (!ctx.hasUI) throw new Error("/codex-fast requires TUI or RPC mode.");
      const command = args.trim();
      if (!["", "on", "off", "status"].includes(command)) {
        ctx.ui.notify("Usage: /codex-fast [on|off|status]", "warning");
        return;
      }
      const model = ctx.model;
      const numbered = isCodexSlot(model?.provider);
      if (!numbered && model?.provider !== "openai-codex") {
        ctx.ui.notify("/codex-fast is available only for OpenAI Codex accounts.", "warning");
        return;
      }
      const enabled = numbered ? slotTier === "priority" : settingsRuntime.get().settings.codexFastMode;
      if (command !== "status") {
        await toggle(ctx, command === "" ? !enabled : command === "on");
        return;
      }
      if (!numbered) {
        const capability = catalog.get(model);
        const availability = codexFastAvailability(model, enabled, capability);
        ctx.ui.notify(
          emphasizeFastDetails(ctx, [
            `Scope: global base-Codex preference (pi-usage.json)`,
            `Fast preference: ${enabled ? "On" : "Off"}`,
            `Current model: ${safeStatuslineText(model ? `${model.provider}/${model.id}` : "none")}`,
            `Availability: ${availability.kind === "available" ? "supported" : "reason" in availability ? availability.reason : "unavailable"}`,
            `Effective Fast request: ${codexFastIsEffective(model, enabled, capability) ? "On" : "Off"}`,
            "Status uses cached capability data; it does not confirm the server's actual tier.",
          ]),
          "info",
        );
        return;
      }
      const request = model ? slotRequests.get(`${model.provider}/${model.id}`) : undefined;
      ctx.ui.notify(
        emphasizeFastDetails(ctx, [
          `Session next request: ${slotTier ?? "unchanged (no override)"}`,
          `Current model: ${safeStatuslineText(model ? `${model.provider}/${model.id}` : "none")}${trustedCodexSlot(model) ? "" : " (not an eligible numbered route)"}`,
          `Last observed request: ${request ? `${request.requested}; server tier: ${request.server ?? "not reported"}` : "none"}`,
          SLOT_FAST_WARNING,
        ]),
        "info",
      );
    },
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreSlotPreference(ctx);
    refreshStatus(ctx);
  });
  pi.on("provider_stream_event", (event) => {
    if (!isRecord(event.data) || event.data.type !== "response.completed" || !isRecord(event.data.response)) return;
    const request = slotRequests.get(`${event.provider}/${event.model}`);
    const server = event.data.response.service_tier;
    if (request && typeof server === "string" && ["default", "priority", "flex", "auto", "scale"].includes(server))
      request.server = server;
  });
  const catalog = createCodexFastCatalog({
    credentialReader: options.credentialReader,
    candidateReader: options.candidateReader ?? createOAuthCredentialCandidateReader(pi, options.credentialReader),
    timeoutMs: options.timeoutMs,
    onChanged(ctx) {
      if (sessionController.signal.aborted || !settingsRuntime.get().settings.codexFastMode) return;
      try {
        refreshStatus(ctx);
      } catch (error) {
        if (!isStaleExtensionContextError(error)) throw error;
      }
    },
  });

  const toggle = async (
    ctx: ExtensionCommandContext,
    enabled: boolean,
    callerSignal?: AbortSignal,
  ): Promise<boolean> => {
    if (isCodexSlot(ctx.model?.provider)) return setSlotPreference(ctx, enabled, callerSignal);
    const ownerGeneration = generation;
    const sessionId = ctx.sessionManager.getSessionId();
    const signal = callerSignal ? AbortSignal.any([callerSignal, sessionController.signal]) : sessionController.signal;
    if (ctx.model?.provider !== "openai-codex") {
      ctx.ui.notify("/codex-fast is available only for the active OpenAI Codex model.", "warning");
      return false;
    }
    if (!isOfficialCodexModel(ctx.model)) {
      ctx.ui.notify("Fast mode requires the official OpenAI Codex Responses endpoint.", "warning");
      return false;
    }
    if (settingsRuntime.get().kind === "invalid") {
      ctx.ui.notify("pi-usage.json is invalid; repair it and run /reload before changing Fast mode.", "error");
      return false;
    }
    if (enabled) {
      const capability = await catalog.read(ctx, signal, true, catalog.get(ctx.model).kind !== "supported");
      if (signal.aborted || ownerGeneration !== generation) return false;
      if (!capability) {
        const latest = catalog.get(ctx.model);
        ctx.ui.notify(
          latest.kind === "unknown"
            ? latest.reason
            : "The active Codex account changed while checking Fast capability.",
          "warning",
        );
        return false;
      }
      const availability = codexFastAvailability(ctx.model, false, capability);
      if (availability.kind !== "available") {
        if (availability.kind === "unknown" || availability.kind === "unavailable") {
          ctx.ui.notify(availability.reason, "warning");
        }
        return false;
      }
    }
    try {
      await settingsRuntime.update({ codexFastMode: enabled }, signal);
    } catch (error) {
      if (isAbortError(error) || isStaleExtensionContextError(error)) return false;
      ctx.ui.notify(`Could not save pi-usage.json: ${errorMessage(error)}`, "error");
      return false;
    }
    if (signal.aborted || ownerGeneration !== generation || ctx.sessionManager.getSessionId() !== sessionId) {
      return false;
    }
    refreshStatus(ctx);
    ctx.ui.notify(
      enabled
        ? `Codex Fast mode enabled. ${FAST_USAGE_WARNING}`
        : "Codex Fast mode disabled; standard routing will be used.",
      "info",
    );
    return true;
  };

  const refreshCapabilities = (ctx: ExtensionContext, callerSignal?: AbortSignal, force = false) => {
    const signal = callerSignal ? AbortSignal.any([callerSignal, sessionController.signal]) : sessionController.signal;
    return catalog.read(ctx, signal, true, force);
  };

  const prepareSession = (ctx: ExtensionContext): Promise<void> => {
    const sessionId = ctx.sessionManager.getSessionId();
    generation += 1;
    sessionController.abort();
    catalog.reset();
    pendingFastRequests.clear();
    restoreSlotPreference(ctx);
    sessionController = new AbortController();
    const ownerGeneration = generation;
    return (async () => {
      let state: Readonly<UsageSettingsState>;
      try {
        state = await settingsRuntime.reload(sessionController.signal);
      } catch (error) {
        if (sessionController.signal.aborted || ownerGeneration !== generation) return;
        if (ctx.hasUI) {
          ctx.ui.notify(`Could not load pi-usage.json; using defaults. ${errorMessage(error)}`, "warning");
        }
        return;
      }
      if (
        sessionController.signal.aborted ||
        ownerGeneration !== generation ||
        ctx.sessionManager.getSessionId() !== sessionId
      ) {
        return;
      }
      if (ctx.hasUI && state.kind === "invalid") {
        ctx.ui.notify(`Invalid pi-usage.json; using defaults without overwriting it. ${state.issue}`, "warning");
      }
      refreshStatus(ctx);
      if (state.kind !== "invalid" && isOfficialCodexModel(ctx.model)) void refreshCapabilities(ctx);
    })();
  };

  if (options.registerSessionStart !== false) {
    pi.on("session_start", async (_event, ctx) => prepareSession(ctx));
  }
  pi.on("model_select", (_event, ctx) => {
    void refreshCapabilities(ctx);
  });

  pi.on("before_provider_request", async (event, ctx) => {
    const ownerGeneration = generation;
    const model = ctx.model;
    if (isCodexSlot(model?.provider)) {
      if (
        sessionController.signal.aborted ||
        !slotTier ||
        !model ||
        !isRecord(event.payload) ||
        !trustedCodexSlot(model)
      )
        return undefined;
      const key = `${model.provider}/${model.id}`;
      if (slotRequests.size >= 32 && !slotRequests.has(key)) {
        const oldest = slotRequests.keys().next().value;
        if (oldest !== undefined) slotRequests.delete(oldest);
      }
      slotRequests.set(key, { requested: slotTier });
      return { ...event.payload, service_tier: slotTier };
    }
    const enabled = settingsRuntime.get().settings.codexFastMode;
    const capability =
      enabled && isOfficialCodexModel(model)
        ? ((await catalog.read(ctx, sessionController.signal)) ?? UNKNOWN_CODEX_FAST_CAPABILITY)
        : UNKNOWN_CODEX_FAST_CAPABILITY;
    if (sessionController.signal.aborted || ownerGeneration !== generation) return undefined;
    const rewritten = rewriteCodexFastPayload(event.payload, model, enabled, capability);
    const key = activeRequestKey(ctx, model);
    if (key && model) {
      pendingFastRequests.set(key, {
        fastRequested: isRecord(rewritten) && rewritten.service_tier === "priority",
        model,
        capability,
      });
    }
    return rewritten;
  });
  pi.on("message_end", (event, ctx) => {
    const request = consumeFastRequest(ctx, event.message, pendingFastRequests);
    if (request === NO_FAST_REQUEST) return undefined;
    const message = correctCodexFastMessageCost(
      event.message,
      request.model,
      request.fastRequested,
      request.capability,
    );
    return message ? { message: message as never } : undefined;
  });
  pi.on("session_shutdown", async () => {
    generation += 1;
    sessionController.abort();
    catalog.reset(true);
    pendingFastRequests.clear();
    slotTier = undefined;
    slotRequests.clear();
    await settingsRuntime.flush();
  });

  return {
    prepareSession,
    refreshCapabilities,
    usageWarning(model: PiModel | undefined) {
      return isCodexSlot(model?.provider) ? SLOT_FAST_WARNING : FAST_USAGE_WARNING;
    },
    availability(model: PiModel | undefined): ReturnType<typeof codexFastAvailability> {
      if (isCodexSlot(model?.provider)) {
        return trustedCodexSlot(model)
          ? { kind: "available", enabled: slotTier === "priority" }
          : { kind: "unavailable", reason: "Numbered Codex Fast requires a verified local account proxy route." };
      }
      return codexFastAvailability(model, settingsRuntime.get().settings.codexFastMode, catalog.get(model));
    },
    decorateStatus(model: PiModel | undefined, status: string) {
      if (isCodexSlot(model?.provider))
        return codexFastStatusLabel(status, slotTier === "priority" && trustedCodexSlot(model));
      const enabled = settingsRuntime.get().settings.codexFastMode;
      const capability = catalog.get(model);
      if (
        enabled &&
        codexFastAvailability(model, enabled, capability).kind === "unknown" &&
        /^codex(?:\s|$)/u.test(status)
      ) {
        return `codex (Fast unknown)${status.slice("codex".length)}`;
      }
      return codexFastStatusLabel(status, codexFastIsEffective(model, enabled, capability));
    },
    toggle,
  };
}

function trustedCodexSlot(model: PiModel | undefined): boolean {
  if (!isCodexSlot(model?.provider)) return false;
  try {
    const text = readFileSync(join(getAgentDir(), "models.json"), "utf8");
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) return false;
    return verifiedCodexSlotRoute(model, JSON.parse(text)) !== undefined;
  } catch {
    return false;
  }
}

function activeRequestKey(ctx: ExtensionContext, model = ctx.model): string | undefined {
  return model ? `${ctx.sessionManager.getSessionId()}:${model.provider}/${model.id}` : undefined;
}

function consumeFastRequest(
  ctx: ExtensionContext,
  message: unknown,
  pending: Map<string, PendingFastRequest>,
): PendingFastRequest | typeof NO_FAST_REQUEST {
  if (!isRecord(message) || message.role !== "assistant") return NO_FAST_REQUEST;
  const key = messageRequestKey(ctx, message);
  if (!key) return NO_FAST_REQUEST;
  const request = pending.get(key);
  pending.delete(key);
  return request ?? NO_FAST_REQUEST;
}

function messageRequestKey(ctx: ExtensionContext, message: Record<string, unknown>): string | undefined {
  if (typeof message.provider !== "string" || typeof message.model !== "string") return undefined;
  return `${ctx.sessionManager.getSessionId()}:${message.provider}/${message.model}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
