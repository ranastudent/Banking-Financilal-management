import type { Request, Response } from "express";
import { requireRouteParam } from "./route-param";
import { createFraudModelDraft, listFraudModels, transitionFraudModel } from "../services/ml-model-registry.service";
export const listModels = async (_req: Request, res: Response) => { res.json({ success: true, data: await listFraudModels() }); };
export const createModel = async (req: Request, res: Response) => {
  const data = await createFraudModelDraft({
    name: String(req.body.name ?? ""), version: String(req.body.version ?? ""),
    featureSchemaVersion: String(req.body.featureSchemaVersion ?? ""),
    ...(req.body.trainingDatasetVersion ? { trainingDatasetVersion: String(req.body.trainingDatasetVersion) } : {}),
    ...(req.body.artifactChecksum ? { artifactChecksum: String(req.body.artifactChecksum) } : {}),
    ...(req.body.evaluationMetrics && typeof req.body.evaluationMetrics === "object" ? { evaluationMetrics: req.body.evaluationMetrics } : {}),
    ...(req.body.metadata && typeof req.body.metadata === "object" ? { metadata: req.body.metadata } : {}),
  }, req.user!.id);
  res.status(201).json({ success: true, data, requestId: req.requestId });
};
export const transitionModel = async (req: Request, res: Response) => {
  const action = String(req.body.action) as "VALIDATE" | "APPROVE" | "DEPLOY" | "DISABLE" | "RETIRE";
  if (!["VALIDATE", "APPROVE", "DEPLOY", "DISABLE", "RETIRE"].includes(action)) {
    res.status(400).json({ success: false, message: "Unsupported model lifecycle action", requestId: req.requestId });
    return;
  }
  const data = await transitionFraudModel(requireRouteParam(req, "modelId"), action, req.user!.id);
  res.json({ success: true, data, requestId: req.requestId });
};
