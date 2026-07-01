#!/usr/bin/env node

import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hyperlink } from "@earendil-works/pi-tui";
import { BastionCliExecutor } from "../bastion-cli/executor.ts";
import { createBastionRuntimeHost, repositoryRoot } from "../runtime-host.ts";
import {
  SCENARIO_DATABASE_PATH,
  SCENARIO_PROMPTS,
} from "./fixture.ts";
import { renderTranscript } from "./transcript.ts";

interface MessageLike {
  role?: string;
  stopReason?: string;
  content?: unknown;
  details?: { kind?: string; ok?: boolean; error?: { message?: string } };
}

function hasText(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string" &&
        (block as { text: string }).text.trim().length > 0,
    )
  );
}

function assertCompletedTurn(
  messages: readonly unknown[],
  start: number,
  turnNumber: number,
): void {
  const turn = messages.slice(start) as MessageLike[];
  const failedTool = turn.find(
    (message) =>
      message.role === "toolResult" &&
      message.details?.kind === "bastion_cli" &&
      message.details.ok === false,
  );
  if (failedTool) {
    throw new Error(
      `Turn ${turnNumber} Bastion tool failed: ${failedTool.details?.error?.message ?? "unknown error"}`,
    );
  }
  const finalAssistant = [...turn]
    .reverse()
    .find((message) => message.role === "assistant");
  if (
    !finalAssistant ||
    finalAssistant.stopReason !== "stop" ||
    !hasText(finalAssistant.content)
  ) {
    throw new Error(
      `Turn ${turnNumber} did not finish with a normal non-empty answer (stopReason=${String(finalAssistant?.stopReason)})`,
    );
  }
  const successfulTool = turn.some(
    (message) =>
      message.role === "toolResult" &&
      message.details?.kind === "bastion_cli" &&
      message.details.ok === true,
  );
  if (!successfulTool) {
    throw new Error(
      `Turn ${turnNumber} completed without a successful Bastion tool call`,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("CLI returned an unexpected data shape");
  }
  return value as Record<string, unknown>;
}

async function verifyDatabase(executablePath: string): Promise<void> {
  const executor = new BastionCliExecutor({
    executablePath,
    databasePath: SCENARIO_DATABASE_PATH,
    timeoutMs: 30_000,
  });
  const players = asRecord((await executor.run(["player", "list"], undefined)).envelope);
  const games = asRecord((await executor.run(["game", "list"], undefined)).envelope);
  const analyses = asRecord(
    (await executor.run(["game", "analysis", "list"], undefined)).envelope,
  );
  const gameDetail = asRecord(
    (await executor.run(["game", "read", "--id", "1"], undefined)).envelope,
  );
  const playerAnalysis = asRecord(
    (
      await executor.run(
        ["game", "analysis", "read", "--game-id", "1", "--player", "林晨"],
        undefined,
      )
    ).envelope,
  );
  for (const [label, envelope] of [
    ["players", players],
    ["games", games],
    ["analyses", analyses],
    ["game detail", gameDetail],
    ["player analysis", playerAnalysis],
  ] as const) {
    if (envelope.ok !== true) {
      throw new Error(`Scenario ${label} verification command failed`);
    }
  }

  const playerData = asRecord(players.data);
  const gameData = asRecord(games.data);
  const analysisData = asRecord(analyses.data);
  const gameDetailData = asRecord(gameDetail.data);
  const playerAnalysisData = asRecord(playerAnalysis.data);
  if (!Array.isArray(playerData.players) || playerData.players.length !== 3) {
    throw new Error("Scenario database does not contain exactly three players");
  }
  if (!Array.isArray(gameData.games) || gameData.games.length !== 1) {
    throw new Error("Scenario database does not contain exactly one game");
  }
  if (
    !Array.isArray(analysisData.analyses) ||
    analysisData.analyses.length === 0
  ) {
    throw new Error("Scenario database does not contain generated analysis");
  }

  const game = asRecord(gameData.games[0]);
  if (game.own_score !== 2 || game.opponent_score !== 1) {
    throw new Error("Scenario game score is not 2:1");
  }
  asRecord(gameDetailData.game);
  if (
    !Array.isArray(gameDetailData.lineups) ||
    gameDetailData.lineups.length !== 3
  ) {
    throw new Error("Scenario game does not contain exactly three lineup entries");
  }
  if (!Array.isArray(gameDetailData.events) || gameDetailData.events.length < 8) {
    throw new Error("Scenario game does not contain the complete event batch");
  }
  if (
    !Array.isArray(playerAnalysisData.player_summaries) ||
    !playerAnalysisData.player_summaries.some(
      (value) => asRecord(value).player === "林晨",
    )
  ) {
    throw new Error("Scenario analysis does not include 林晨");
  }
}

async function requireNonemptyFile(path: string): Promise<void> {
  if ((await stat(path)).size === 0) {
    throw new Error(`Expected a non-empty output file: ${path}`);
  }
}

function link(path: string): string {
  return hyperlink(path, pathToFileURL(path).href);
}

export async function runScenario(): Promise<void> {
  await unlink(SCENARIO_DATABASE_PATH).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });

  const host = await createBastionRuntimeHost({
    databasePath: SCENARIO_DATABASE_PATH,
    confirmWrite: async () => true,
  });
  try {
    const session = host.runtime.session;
    // Keep the deterministic scenario within providers with small output
    // budgets; the test validates behavior rather than deep deliberation.
    session.setThinkingLevel("low");
    await session.prompt("/dev");
    for (const [index, prompt] of SCENARIO_PROMPTS.entries()) {
      const start = session.messages.length;
      await session.prompt(prompt);
      assertCompletedTurn(session.messages, start, index + 1);
    }

    await verifyDatabase(join(repositoryRoot(), "out", "bastion"));

    const sessionFile = session.sessionFile;
    if (!sessionFile) throw new Error("Scenario session did not create a JSONL file");
    const devLogFile = join(
      host.agentDir,
      "logs",
      `${session.sessionId}.provider-payload.jsonl`,
    );
    const transcriptFile = join(
      "/tmp",
      `bastion-runtime-scenario-${session.sessionId}.md`,
    );
    const transcript = renderTranscript(session.messages);
    await writeFile(transcriptFile, transcript, { encoding: "utf8", mode: 0o600 });
    await requireNonemptyFile(sessionFile);
    await requireNonemptyFile(devLogFile);
    await requireNonemptyFile(transcriptFile);
    await readFile(devLogFile, "utf8");

    process.stdout.write(`\n${transcript}\n`);
    process.stdout.write(`对话 Markdown: ${link(transcriptFile)}\n`);
    process.stdout.write(`Session JSONL: ${link(sessionFile)}\n`);
    process.stdout.write(`Dev payload JSONL: ${link(devLogFile)}\n`);
  } finally {
    await host.dispose();
  }
}

runScenario().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Runtime scenario test failed:\n${message}`);
  process.exitCode = 1;
});
