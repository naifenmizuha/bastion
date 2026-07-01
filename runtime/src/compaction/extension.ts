import type {
  ExtensionContext,
  ExtensionFactory,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { BastionCliParams } from "../bastion-cli/types.ts";
import {
  buildCheckpoint,
  emergencyNarrative,
  isBastionCompactionDetails,
  renderCheckpoint,
} from "./checkpoint.ts";
import { extractBastionContext } from "./extractor.ts";
import { BastionFreshnessGuard } from "./freshness-guard.ts";
import {
  summarizeNarrative,
  type NarrativeSummarizer,
} from "./narrative.ts";
import type { BastionCompactionDetails } from "./types.ts";

export interface BastionCompactionExtensionOptions {
  summarize?: NarrativeSummarizer;
  now?: () => number;
  onProviderPayload?: (
    payload: unknown,
    model: NonNullable<ExtensionContext["model"]>,
    context: ExtensionContext,
  ) => void | Promise<void>;
}

function previousDetails(
  entries: readonly SessionEntry[],
): BastionCompactionDetails | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "compaction") continue;
    return isBastionCompactionDetails(entry.details)
      ? entry.details
      : undefined;
  }
  return undefined;
}

function fileLists(
  fileOps: {
    read: Set<string>;
    written: Set<string>;
    edited: Set<string>;
  },
): { readFiles: string[]; modifiedFiles: string[] } {
  const modified = new Set([...fileOps.written, ...fileOps.edited]);
  return {
    readFiles: [...fileOps.read].filter((path) => !modified.has(path)).sort(),
    modifiedFiles: [...modified].sort(),
  };
}

function paramsFromToolInput(input: Record<string, unknown>): BastionCliParams | undefined {
  if (
    !Array.isArray(input.args) ||
    input.args.some((item) => typeof item !== "string")
  ) {
    return undefined;
  }
  return {
    args: input.args as string[],
    ...("input" in input ? { input: input.input } : {}),
  };
}

export function createBastionCompactionExtension(
  options: BastionCompactionExtensionOptions = {},
): ExtensionFactory {
  const summarize = options.summarize ?? summarizeNarrative;
  const now = options.now ?? Date.now;

  return (pi) => {
    const guard = new BastionFreshnessGuard();

    pi.on("session_start", (_event, ctx) => {
      const details = previousDetails(ctx.sessionManager.getBranch());
      if (details) guard.load(details);
    });

    pi.on("session_before_compact", async (event, ctx) => {
      const messages = [
        ...event.preparation.messagesToSummarize,
        ...event.preparation.turnPrefixMessages,
      ];
      try {
        const previous = previousDetails(event.branchEntries);
        const legacySummary =
          !previous && event.preparation.previousSummary
            ? event.preparation.previousSummary
            : undefined;
        const extraction = extractBastionContext(messages);
        let narrative;
        let fallbackUsed = false;
        const warnings: string[] = [];
        try {
          narrative = await summarize({
            messages,
            previous: previous?.narrative,
            legacySummary,
            customInstructions: event.customInstructions,
            signal: event.signal,
            context: ctx,
            onProviderPayload: options.onProviderPayload
              ? (payload, model) =>
                  options.onProviderPayload!(payload, model, ctx)
              : undefined,
          });
        } catch (error) {
          if (event.signal.aborted) return { cancel: true };
          fallbackUsed = true;
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`NARRATIVE_FALLBACK:${message}`);
          narrative = emergencyNarrative(
            messages,
            previous?.narrative,
            legacySummary,
          );
          ctx.ui.notify(
            "Bastion narrative summary failed; using a deterministic emergency checkpoint.",
            "warning",
          );
        }
        const files = fileLists(event.preparation.fileOps);
        const details = buildCheckpoint({
          previous,
          extraction,
          narrative,
          trigger: event.reason,
          willRetry: event.willRetry,
          generatedAt: now(),
          sourceMessageCount: messages.length,
          fallbackUsed,
          readFiles: files.readFiles,
          modifiedFiles: files.modifiedFiles,
          warnings: [
            ...warnings,
            ...(legacySummary ? ["LEGACY_SUMMARY_MIGRATED"] : []),
          ],
        });
        guard.load(details);
        return {
          compaction: {
            summary: renderCheckpoint(details),
            firstKeptEntryId: event.preparation.firstKeptEntryId,
            tokensBefore: event.preparation.tokensBefore,
            details,
          },
        };
      } catch (error) {
        if (!event.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(
            `Bastion checkpoint extraction failed; using Pi default compaction: ${message}`,
            "warning",
          );
        }
        return undefined;
      }
    });

    pi.on("session_compact", (event) => {
      if (isBastionCompactionDetails(event.compactionEntry.details)) {
        guard.load(event.compactionEntry.details);
      }
    });

    pi.on("tool_result", (event) => {
      if (event.toolName === "bastion_cli") {
        guard.observeToolResult(event.details);
      }
    });

    pi.on("tool_call", (event) => {
      if (event.toolName !== "bastion_cli") return;
      const params = paramsFromToolInput(event.input);
      if (!params) return;
      const reason = guard.blockReason(params);
      return reason ? { block: true, reason } : undefined;
    });
  };
}
