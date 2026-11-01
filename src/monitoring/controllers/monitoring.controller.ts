import type { Request, Response } from "express";
import { requireRouteParam } from "./route-param";
import { ingestMonitoringEvent } from "../services/monitoring-event.service";
import { processMonitoringEvent } from "../services/monitoring-processing.service";

export const ingestEvent = async (req: Request, res: Response) => {
  const result = await ingestMonitoringEvent(req.body);
  res.status(202).json({ success: true, data: { eventId: result.event.id, status: result.event.status, duplicate: result.duplicate }, requestId: req.requestId });
};
export const retryEvent = async (req: Request, res: Response) => {
  const result = await processMonitoringEvent(requireRouteParam(req, "eventId"));
  res.status(200).json({ success: true, data: result, requestId: req.requestId });
};
