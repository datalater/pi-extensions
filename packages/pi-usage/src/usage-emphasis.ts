import type { ExtensionCommandContext, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { safeStatuslineText } from "./statusline-display.js";

/** Keep account identity in the same minimal, quota-colored status item. */
export function emphasizeCodexStatus(
  ctx: ExtensionContext,
  value: string | undefined,
  severity?: "error" | "warning" | "success",
): string | undefined {
  const identity = ctx.mode === "tui" ? codexIdentity(ctx.model?.provider) : undefined;
  const text =
    value && identity && /^codex(?:\s|$)/u.test(value) ? identity.label + value.slice("codex".length) : value;
  return text && severity ? ctx.ui.theme.fg(severity, text) : text;
}

/** Apply only semantic values in our own status notification; RPC stays plain text. */
export function emphasizeFastDetails(ctx: ExtensionContext, lines: readonly string[]): string {
  if (ctx.mode !== "tui") return lines.join("\n");
  return lines
    .map((line) => {
      if (/^(?:Fast preference|Session next request): /u.test(line)) {
        const split = line.indexOf(": ") + 2;
        return line.slice(0, split) + ctx.ui.theme.bold(ctx.ui.theme.fg("accent", line.slice(split)));
      }
      const observation = /^Last observed request: (priority|default); server tier: (\w+)$/u.exec(line);
      if (observation && observation[1] !== observation[2]) {
        return ctx.ui.theme.fg("warning", line);
      }
      return line;
    })
    .join("\n");
}

/** Kit sanitizes lines before fg("muted"). Decorate at that trusted render boundary,
 * not by injecting ANSI into screen data or weakening shared Kit sanitization. */
export function withUsageEmphasis(ctx: ExtensionCommandContext): ExtensionCommandContext {
  if (ctx.mode !== "tui") return ctx;
  const ui = new Proxy(ctx.ui, {
    get(target, property, receiver) {
      if (property !== "custom") return Reflect.get(target, property, receiver);
      const originalCustom = target.custom;
      return <T>(factory: Parameters<typeof originalCustom<T>>[0], options?: Parameters<typeof originalCustom<T>>[1]) =>
        target.custom<T>((tui, theme, keybindings, done) => {
          const emphasizedTheme = new Proxy(theme, {
            get(original, key) {
              if (key === "fg")
                return (role: ThemeColor, text: string) => {
                  if (role !== "muted") return original.fg(role, text);
                  return emphasizeUsageLine(original, text, ctx.model?.provider);
                };
              const member = Reflect.get(original, key, original);
              return typeof member === "function" ? member.bind(original) : member;
            },
          });
          return factory(tui, emphasizedTheme, keybindings, done);
        }, options);
    },
  });
  return new Proxy(ctx, {
    get(target, property, receiver) {
      return property === "ui" ? ui : Reflect.get(target, property, receiver);
    },
  });
}

function emphasizeUsageLine(theme: Theme, text: string, provider: string | undefined): string {
  const match = /^(Account: )(.*)$/u.exec(text) ?? /^(Credits:\s+)(.*)$/u.exec(text);
  if (!match) return theme.fg("muted", text);
  const color = text.startsWith("Account:")
    ? (codexIdentity(match[2])?.color ?? codexIdentity(provider)?.color ?? "accent")
    : "accent";
  return theme.fg("muted", match[1]) + theme.bold(theme.fg(color, safeStatuslineText(match[2])));
}

function codexIdentity(provider: string | undefined): { label: string; color: ThemeColor } | undefined {
  if (provider === "openai-codex") return { label: "codex", color: "text" };
  const slot = /^openai-codex-account-([1-9]\d*)$/u.exec(provider ?? "")?.[1];
  if (!slot) return undefined;
  return { label: `codex a${slot}`, color: "text" };
}
