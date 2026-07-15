import { randomUUID } from "node:crypto";
import type {
  TeamOpsParams,
  TeamOpsToolDetails,
} from "../teamops/types.ts";
import { writeChangeTopics } from "./command-topics.ts";
import type { ChangeEventPublisher } from "./types.ts";

export function publishTeamOpsChange(
  toolCallId: string,
  params: TeamOpsParams,
  details: TeamOpsToolDetails,
  publisher: ChangeEventPublisher,
  occurredAt = Date.now(),
): void {
  if (details.risk === undefined || details.risk === "read") return;
  const writeMayHavePersisted = details.ok || details.result?.envelope.ok === true;
  if (!writeMayHavePersisted) return;
  const topics = writeChangeTopics(params.args);
  if (topics.length === 0) return;
  publisher.publish({
    id: randomUUID(),
    topics,
    occurredAt,
    sourceToolCallId: toolCallId,
  });
}
