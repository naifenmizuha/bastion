import type { Model } from "@earendil-works/pi-ai";

export type RoutedTaskType = "transactional" | "creative";

export interface ModelIdentity {
  provider: string;
  id: string;
}

export interface ModelRoutingConfig {
  simple: ModelIdentity;
  complex: ModelIdentity;
}

export interface ClassificationUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface TaskClassification {
  taskType: RoutedTaskType;
  usage: ClassificationUsage;
}

export interface RoutingModels {
  simple: Model<any>;
  complex: Model<any>;
}

export interface ModelRouteAuditEntry {
  version: 1;
  taskType: RoutedTaskType;
  targetModel: ModelIdentity;
  classifierModel: ModelIdentity;
  classifierUsage?: ClassificationUsage;
  fallbackReason?: string;
  timestamp: string;
}

export const MODEL_ROUTE_ENTRY_TYPE = "bastion-model-route";
