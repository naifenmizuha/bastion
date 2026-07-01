#!/usr/bin/env node

import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { createBastionRuntimeHost } from "./runtime-host.ts";

export async function main(): Promise<void> {
  const host = await createBastionRuntimeHost();
  try {
    await new InteractiveMode(host.runtime).run();
  } finally {
    await host.dispose();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Failed to start Bastion Agent Runtime:\n${message}`);
  process.exitCode = 1;
});
