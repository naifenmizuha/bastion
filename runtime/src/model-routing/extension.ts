import type { Model } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ExtensionFactory,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  classifyTask,
  TaskClassificationError,
  type ClassificationInput,
} from "./classifier.ts";
import {
  MODEL_ROUTE_ENTRY_TYPE,
  type ModelRouteAuditEntry,
  type RoutingModels,
  type TaskClassification,
} from "./types.ts";

export type TaskClassifier = (
  input: ClassificationInput,
  context: ExtensionContext,
) => Promise<TaskClassification>;

export interface ModelRoutingExtensionOptions {
  models: RoutingModels;
  settingsManager: SettingsManager;
  classify?: TaskClassifier;
  now?: () => number;
  timeoutMs?: number;
  onProviderPayload?: (
    payload: unknown,
    model: Model<any>,
    context: ExtensionContext,
  ) => void | Promise<void>;
}

const STATUS_KEY = "bastion-model-router";

function modelsEqual(
  left: Model<any> | undefined,
  right: Model<any> | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.provider === right.provider &&
      left.id === right.id,
  );
}

function messageText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (item): item is { type: "text"; text: string } =>
        typeof item === "object" &&
        item !== null &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string",
    )
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function recentConversationContext(entries: readonly unknown[]): {
  previousUser?: string;
  previousAssistant?: string;
} {
  let previousUser: string | undefined;
  let previousAssistant: string | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as { type?: unknown; message?: unknown };
    if (raw.type !== "message" || !raw.message) continue;
    const message = raw.message as { role?: unknown };
    if (!previousAssistant && message.role === "assistant") {
      previousAssistant = messageText(raw.message) || undefined;
    } else if (!previousUser && message.role === "user") {
      previousUser = messageText(raw.message) || undefined;
    }
    if (previousUser && previousAssistant) break;
  }
  return {
    ...(previousUser ? { previousUser } : {}),
    ...(previousAssistant ? { previousAssistant } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createModelRoutingExtension(
  options: ModelRoutingExtensionOptions,
): ExtensionFactory {
  return (pi) => {
    const now = options.now ?? Date.now;
    const classify: TaskClassifier =
      options.classify ??
      ((input, context) =>
        classifyTask({
          ...input,
          model: options.models.simple,
          context,
          timeoutMs: options.timeoutMs,
          onProviderPayload: options.onProviderPayload,
        }));
    let sessionStarted = false;
    let manualOverride = false;
    let internalModelSwitch = false;
    let baselineModel: Model<any> | undefined;

    function setStatus(
      context: ExtensionContext,
      value: string | undefined,
    ): void {
      if (context.mode === "tui") context.ui.setStatus(STATUS_KEY, value);
    }

    async function setModel(model: Model<any>): Promise<boolean> {
      internalModelSwitch = true;
      try {
        return await pi.setModel(model);
      } finally {
        internalModelSwitch = false;
      }
    }

    async function restoreBaseline(): Promise<void> {
      const model = baselineModel;
      baselineModel = undefined;
      if (!model) return;
      if (!(await setModel(model))) {
        throw new Error(
          `could not restore model ${model.provider}/${model.id}`,
        );
      }
    }

    pi.on("session_start", (_event, context) => {
      sessionStarted = true;
      manualOverride = false;
      baselineModel = undefined;
      setStatus(context, "Route: auto");
    });

    pi.on("model_select", (_event, context) => {
      if (!sessionStarted || internalModelSwitch) return;
      manualOverride = true;
      baselineModel = undefined;
      setStatus(context, "Route: manual");
      if (context.mode === "tui") {
        context.ui.notify(
          "Automatic model routing is disabled for this session after manual model selection.",
          "info",
        );
      }
    });

    pi.on("before_agent_start", async (event, context) => {
      if (manualOverride) return;
      await restoreBaseline();
      const originalModel = context.model;
      if (!originalModel) {
        throw new Error("model routing requires an active baseline model");
      }

      const prior = recentConversationContext(
        context.sessionManager.getEntries() as readonly unknown[],
      );
      let taskType: TaskClassification["taskType"] = "creative";
      let classifierUsage: TaskClassification["usage"] | undefined;
      let fallbackReason: string | undefined;
      try {
        const result = await classify(
          { prompt: event.prompt, ...prior },
          context,
        );
        taskType = result.taskType;
        classifierUsage = result.usage;
      } catch (error) {
        fallbackReason = errorMessage(error);
        if (error instanceof TaskClassificationError) {
          classifierUsage = error.usage;
        }
      }

      let targetModel =
        taskType === "transactional"
          ? options.models.simple
          : options.models.complex;
      if (!modelsEqual(originalModel, targetModel)) {
        const switched = await setModel(targetModel);
        if (!switched && taskType === "transactional") {
          taskType = "creative";
          fallbackReason = fallbackReason
            ? `${fallbackReason}; simple execution model unavailable`
            : "simple execution model unavailable";
          targetModel = options.models.complex;
          if (!modelsEqual(originalModel, targetModel)) {
            if (!(await setModel(targetModel))) {
              throw new Error(
                `complex routing model is unavailable: ${targetModel.provider}/${targetModel.id}`,
              );
            }
          }
        } else if (!switched) {
          throw new Error(
            `complex routing model is unavailable: ${targetModel.provider}/${targetModel.id}`,
          );
        }
      }

      if (!modelsEqual(originalModel, targetModel)) {
        baselineModel = originalModel;
        options.settingsManager.setDefaultModelAndProvider(
          originalModel.provider,
          originalModel.id,
        );
      }

      const audit: ModelRouteAuditEntry = {
        version: 1,
        taskType,
        targetModel: {
          provider: targetModel.provider,
          id: targetModel.id,
        },
        classifierModel: {
          provider: options.models.simple.provider,
          id: options.models.simple.id,
        },
        ...(classifierUsage ? { classifierUsage } : {}),
        ...(fallbackReason ? { fallbackReason } : {}),
        timestamp: new Date(now()).toISOString(),
      };
      pi.appendEntry(MODEL_ROUTE_ENTRY_TYPE, audit);
      setStatus(context, `Route: ${taskType} → ${targetModel.id}`);
    });

    pi.on("agent_end", async (_event, context) => {
      await restoreBaseline();
      if (!manualOverride) setStatus(context, "Route: auto");
    });

    pi.on("session_shutdown", async () => {
      await restoreBaseline();
      sessionStarted = false;
    });
  };
}
