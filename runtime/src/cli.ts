import { readFileSync } from "node:fs";
import type { ThinkingLevel } from "./eval/types.ts";

export type RuntimeCliMode = "interactive" | "text" | "json" | "rpc";

export interface RuntimeCliOptions {
  mode: RuntimeCliMode;
  prompt?: string;
  print: boolean;
  sessionId?: string;
  model?: { provider: string; id: string };
  thinkingLevel?: ThinkingLevel;
  help: boolean;
  version: boolean;
}

const MODES = new Set<RuntimeCliMode>(["text", "json", "rpc"]);
const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

function requireValue(
  args: string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseModel(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("--model must use provider/model format");
  }
  return {
    provider: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

export function parseRuntimeCliArgs(args: string[]): RuntimeCliOptions {
  let mode: RuntimeCliMode | undefined;
  let prompt: string | undefined;
  let print = false;
  let sessionId: string | undefined;
  let model: { provider: string; id: string } | undefined;
  let thinkingLevel: ThinkingLevel | undefined;
  let help = false;
  let version = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--version":
      case "-v":
        version = true;
        break;
      case "--mode": {
        if (mode !== undefined) throw new Error("--mode may only be specified once");
        const value = requireValue(args, index, arg);
        if (!MODES.has(value as RuntimeCliMode)) {
          throw new Error(`invalid --mode ${JSON.stringify(value)}; expected text, json, or rpc`);
        }
        mode = value as RuntimeCliMode;
        index++;
        break;
      }
      case "--print":
      case "-p": {
        if (print) throw new Error("-p/--print may only be specified once");
        print = true;
        const next = args[index + 1];
        if (
          next !== undefined &&
          (!next.startsWith("-") || next.startsWith("---"))
        ) {
          prompt = next;
          index++;
        }
        break;
      }
      case "--session":
      case "--session-id":
        if (sessionId !== undefined) {
          throw new Error("--session/--session-id may only be specified once");
        }
        sessionId = requireValue(args, index, arg);
        index++;
        break;
      case "--model":
        if (model !== undefined) throw new Error("--model may only be specified once");
        model = parseModel(requireValue(args, index, arg));
        index++;
        break;
      case "--thinking": {
        if (thinkingLevel !== undefined) throw new Error("--thinking may only be specified once");
        const value = requireValue(args, index, arg);
        if (!THINKING_LEVELS.has(value as ThinkingLevel)) {
          throw new Error(
            `invalid --thinking ${JSON.stringify(value)}; expected off, minimal, low, medium, high, or xhigh`,
          );
        }
        thinkingLevel = value as ThinkingLevel;
        index++;
        break;
      }
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (help || version) {
    if (args.length !== 1) {
      throw new Error(`${help ? "--help" : "--version"} cannot be combined with other arguments`);
    }
    return { mode: "interactive", print: false, help, version };
  }

  if (mode === undefined) {
    if (args.length > 0) {
      throw new Error("--mode is required when CLI options are provided");
    }
    return { mode: "interactive", print: false, help: false, version: false };
  }
  if (mode === "rpc" && print) {
    throw new Error("RPC mode reads commands from stdin and cannot accept -p/--print");
  }
  if ((mode === "text" || mode === "json") && !print) {
    throw new Error(`${mode} mode requires -p/--print`);
  }

  return {
    mode,
    print,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    help: false,
    version: false,
  };
}

export function runtimeVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("runtime package version is missing");
  }
  return packageJson.version;
}

export const RUNTIME_CLI_HELP = `Bastion Agent Runtime

Usage:
  bastion-runtime
  bastion-runtime --mode text -p <prompt> [options]
  bastion-runtime --mode json -p <prompt> [options]
  bastion-runtime --mode rpc [options]

Options:
  --mode <text|json|rpc>        Select headless output mode
  -p, --print [prompt]          Prompt argument, or read it from piped stdin
  --session, --session-id <id>  Resume or create an exact session ID
  --model <provider/model>      Override the configured model for this process
  --thinking <level>            off|minimal|low|medium|high|xhigh
  -h, --help                    Show this help
  -v, --version                 Show the runtime version
`;
