import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const clientRequestId = req.header("X-Request-ID");

  // Restrict caller-supplied IDs to a safe printable character set to avoid
  // log injection. Invalid/oversized values are replaced with a UUID.
  const requestId =
    clientRequestId && /^[A-Za-z0-9._:-]{1,100}$/.test(clientRequestId)
      ? clientRequestId
      : randomUUID();

  req.requestId = requestId;
  const safePath = req.path || req.originalUrl.split("?")[0] || "/";

  res.setHeader("X-Request-ID", requestId);

  console.log(
    `[Request ID] ${req.method} ${safePath} requestId=${requestId}`,
  );

  next();
};