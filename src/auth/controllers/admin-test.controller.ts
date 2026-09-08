import type { Request, Response } from "express";

export const getAdminTest = (
  req: Request,
  res: Response,
): void => {
  res.status(200).json({
    success: true,
    data: {
      message: "Admin route accessed successfully",
      user: req.user,
    },
    requestId: req.requestId,
  });
};