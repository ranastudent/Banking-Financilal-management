import { Request, Response, NextFunction } from "express";

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const startTime = process.hrtime.bigint();

  const timestamp = new Date().toISOString();
  // Never include query strings: authentication/reset links and identifiers
  // are sometimes accidentally placed in query parameters.
  const safePath = req.path || req.originalUrl.split("?")[0] || "/";

  res.on("finish", () => {
    const endTime = process.hrtime.bigint();

    const durationMs =
      Number(endTime - startTime) / 1_000_000;

    console.log(
      `[Request] ${req.method} ${safePath} ` +
        `requestId=${req.requestId} ` +
        `status=${res.statusCode} ` +
        `duration=${durationMs.toFixed(2)}ms ` +
        `timestamp=${timestamp}`,
    );
  });

  next();
};