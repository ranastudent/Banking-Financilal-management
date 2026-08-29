import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const clientRequestId = req.header("X-Request-ID");

  const requestId =
    clientRequestId && clientRequestId.length <= 100
      ? clientRequestId
      : randomUUID();

  req.requestId = requestId;

  res.setHeader("X-Request-ID", requestId);

  console.log(
  `[Request] ${req.method} ${req.originalUrl} requestId=${requestId}`,
 );

  next();
};