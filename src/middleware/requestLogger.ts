import { Request, Response, NextFunction } from "express";

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const startTime = process.hrtime.bigint();

  const timestamp = new Date().toISOString();

  res.on("finish", () => {
    const endTime = process.hrtime.bigint();

    const durationMs =
      Number(endTime - startTime) / 1_000_000;

    console.log(
      `[Request] ${req.method} ${req.originalUrl} ` +
        `requestId=${req.requestId} ` +
        `status=${res.statusCode} ` +
        `duration=${durationMs.toFixed(2)}ms ` +
        `timestamp=${timestamp}`,
    );
  });

  next();
};