import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  projectContext,
  type ContextProjectionDiagnostics,
} from "./projection.ts";

export interface ContextProjectionOptions {
  onProjection?: (diagnostics: ContextProjectionDiagnostics) => void;
}

export function createContextProjectionExtension(
  options: ContextProjectionOptions = {},
): ExtensionFactory {
  return (pi) => {
    pi.on("context", (event) => {
      const projection = projectContext(event.messages);
      options.onProjection?.(projection.diagnostics);
      return { messages: projection.messages };
    });
  };
}

