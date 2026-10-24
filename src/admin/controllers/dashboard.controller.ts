import type { Request, Response } from "express";
import { getAdminDashboard } from "../services/dashboard.service";

export const getDashboard = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const dashboard = await getAdminDashboard();

  res.status(200).json({
    success: true,
    data: dashboard,
    requestId: req.requestId,
  });
};
