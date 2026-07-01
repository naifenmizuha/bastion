import { appendFile, chmod, mkdir, open } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { hyperlink } from "@earendil-works/pi-tui";

export type ProviderPayloadSource = "agent" | "compaction";

export interface ProviderModelIdentity {
  provider: string;
  id: string;
}

export interface DeveloperModeOptions {
  logDirectory: string;
  sessionId: string;
  now?: () => number;
  prepareLogFile?: (directory: string, filePath: string) => Promise<void>;
  appendLogLine?: (filePath: string, line: string) => Promise<void>;
}

export interface DeveloperMode {
  extension: ExtensionFactory;
  logFilePath: string;
  isEnabled(): boolean;
  capturePayload(
    source: ProviderPayloadSource,
    payload: unknown,
    model: ProviderModelIdentity | undefined,
    context: ExtensionContext,
  ): Promise<void>;
}

const STATUS_KEY = "bastion-developer-mode";

async function preparePrivateLogFile(
  directory: string,
  filePath: string,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const handle = await open(filePath, "a", 0o600);
  await handle.close();
  await chmod(filePath, 0o600);
}

async function appendLine(filePath: string, line: string): Promise<void> {
  await appendFile(filePath, line, { encoding: "utf8", mode: 0o600 });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDeveloperMode(
  options: DeveloperModeOptions,
): DeveloperMode {
  const now = options.now ?? Date.now;
  const prepareLogFile = options.prepareLogFile ?? preparePrivateLogFile;
  const appendLogLine = options.appendLogLine ?? appendLine;
  const logFilePath = join(
    options.logDirectory,
    `${options.sessionId}.provider-payload.jsonl`,
  );
  let enabled = false;

  function logFileLink(): string {
    return hyperlink(
      basename(logFilePath),
      pathToFileURL(logFilePath).href,
    );
  }

  function setStatus(context: ExtensionContext, visible: boolean): void {
    if (context.mode !== "tui") return;
    context.ui.setStatus(
      STATUS_KEY,
      visible ? `Dev log: ${logFileLink()}` : undefined,
    );
  }

  function disableAfterFailure(
    context: ExtensionContext,
    operation: string,
    error: unknown,
  ): void {
    enabled = false;
    setStatus(context, false);
    context.ui.notify(
      `Developer mode was disabled because the payload log could not be ${operation}: ${errorMessage(error)}`,
      "error",
    );
  }

  async function capturePayload(
    source: ProviderPayloadSource,
    payload: unknown,
    model: ProviderModelIdentity | undefined,
    context: ExtensionContext,
  ): Promise<void> {
    if (!enabled) return;

    try {
      const record = {
        timestamp: new Date(now()).toISOString(),
        source,
        sessionId: options.sessionId,
        model: model
          ? { provider: model.provider, id: model.id }
          : null,
        payload,
      };
      await appendLogLine(logFilePath, `${JSON.stringify(record)}\n`);
    } catch (error) {
      disableAfterFailure(context, "written", error);
    }
  }

  const extension: ExtensionFactory = (pi) => {
    pi.on("session_start", (_event, context) => {
      enabled = false;
      setStatus(context, false);
    });

    pi.registerCommand("dev", {
      description: "Toggle logging of final LLM provider payloads",
      handler: async (args, context) => {
        if (args.trim()) {
          context.ui.notify("Usage: /dev", "warning");
          return;
        }

        if (enabled) {
          enabled = false;
          setStatus(context, false);
          context.ui.notify("Developer mode disabled.", "info");
          return;
        }

        try {
          await prepareLogFile(options.logDirectory, logFilePath);
        } catch (error) {
          disableAfterFailure(context, "created", error);
          return;
        }

        enabled = true;
        setStatus(context, true);
        context.ui.notify(
          `Developer mode enabled. LLM payload log: ${logFileLink()}`,
          "info",
        );
      },
    });

    pi.on("before_provider_request", async (event, context) => {
      await capturePayload("agent", event.payload, context.model, context);
    });
  };

  return {
    extension,
    logFilePath,
    isEnabled: () => enabled,
    capturePayload,
  };
}
