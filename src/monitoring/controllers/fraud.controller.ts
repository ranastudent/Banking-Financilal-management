import type { Request, Response } from "express";
import { requireRouteParam } from "./route-param";
import { prisma } from "../../config/prisma";
import { createCaseFromAlert, transitionFraudAlert, addFraudCaseNote, addFraudCaseEvidence, assignFraudCase, transitionFraudCase } from "../services/fraud-alert.service";
import { getFraudIntelligenceDashboard } from "../services/fraud-dashboard.service";
const db = prisma as any;

export const listAlerts = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
  const [data,total] = await Promise.all([
    db.fraudAlert.findMany({ where: req.query.status ? { status: String(req.query.status) } : {}, orderBy: { createdAt: "desc" }, skip: (page-1)*limit, take: limit }),
    db.fraudAlert.count({ where: req.query.status ? { status: String(req.query.status) } : {} }),
  ]);
  res.json({ success: true, data, pagination: { page, limit, total }, requestId: req.requestId });
};
export const updateAlert = async (req: Request, res: Response) => {
  const data = await transitionFraudAlert(requireRouteParam(req, "alertId"), String(req.body.status), req.user!.id, req.body.comment);
  res.json({ success: true, data, requestId: req.requestId });
};
export const createCase = async (req: Request, res: Response) => {
  const data = await createCaseFromAlert(requireRouteParam(req, "alertId"), req.user!.id);
  res.status(201).json({ success: true, data, requestId: req.requestId });
};
export const listCases = async (_req: Request, res: Response) => {
  const data = await db.fraudCase.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { alerts: { include: { fraudAlert: true } }, assignments: { where: { unassignedAt: null } } } });
  res.json({ success: true, data });
};
export const addCaseNote = async (req: Request, res: Response) => {
  const data = await addFraudCaseNote(requireRouteParam(req, "caseId"), req.user!.id, String(req.body.body ?? ""), req.body.isInternal !== false);
  res.status(201).json({ success: true, data, requestId: req.requestId });
};
export const assignCase = async (req: Request, res: Response) => {
  const data = await assignFraudCase(requireRouteParam(req, "caseId"), String(req.body.assignedToId), req.user!.id, req.body.reason);
  res.status(201).json({ success: true, data, requestId: req.requestId });
};
export const updateCase = async (req: Request, res: Response) => {
  const data = await transitionFraudCase(requireRouteParam(req, "caseId"), String(req.body.status), req.user!.id, req.body.comment, req.body.resolution);
  res.json({ success: true, data, requestId: req.requestId });
};
export const dashboard = async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  res.json({ success: true, data: await getFraudIntelligenceDashboard(from, to), requestId: req.requestId });
};


export const addCaseEvidence = async (req: Request, res: Response) => {
  const data = await addFraudCaseEvidence({
    caseId: requireRouteParam(req, "caseId"),
    uploadedById: req.user!.id,
    evidenceType: String(req.body.evidenceType) as any,
    storageRef: String(req.body.storageRef ?? ""),
    ...(req.body.fileName ? { fileName: String(req.body.fileName) } : {}),
    ...(req.body.mimeType ? { mimeType: String(req.body.mimeType) } : {}),
    ...(req.body.checksum ? { checksum: String(req.body.checksum) } : {}),
    ...(req.body.description ? { description: String(req.body.description) } : {}),
  });
  res.status(201).json({ success: true, data, requestId: req.requestId });
};
