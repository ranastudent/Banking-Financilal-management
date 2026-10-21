import { createHash } from "crypto";
import type { RequestHandler } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../config/prisma";
import { AppError } from "../errors/AppError";
import { ErrorCode } from "../errors/errorCodes";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESERVATION_ATTEMPTS = 3;

const stableStringify = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const object = value as Record<string, unknown>;

  return `{${Object.keys(object)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(object[key])}`,
    )
    .join(",")}}`;
};

const createRequestHash = (
  method: string,
  path: string,
  params: Record<string, unknown>,
  body: unknown,
): string => {
  return createHash("sha256")
    .update(stableStringify({ method, path, params, body }))
    .digest("hex");
};

const sendIdempotentResponse = (
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  responseStatus: number,
  responseBody: Prisma.JsonValue,
) => {
  return res.status(responseStatus).json({
    success: true,
    data: responseBody,
    requestId: req.requestId,
  });
};

const conflict = (message: string): AppError =>
  new AppError(message, 409, ErrorCode.CONFLICT);

export const requireIdempotencyKey: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const user = req.user;

    if (!user) {
      throw new AppError(
        "Authentication is required",
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    const rawKey = req.get("Idempotency-Key");

    if (!rawKey) {
      throw new AppError(
        "Idempotency-Key header is required",
        400,
        ErrorCode.BAD_REQUEST,
      );
    }

    const key = rawKey.trim();

    if (!key) {
      throw new AppError(
        "Idempotency-Key header cannot be empty",
        400,
        ErrorCode.BAD_REQUEST,
      );
    }

    if (key.length > 128) {
      throw new AppError(
        "Idempotency-Key must not exceed 128 characters",
        400,
        ErrorCode.BAD_REQUEST,
      );
    }

    if (!/^[\x21-\x7E]+$/.test(key)) {
      throw new AppError(
        "Idempotency-Key contains invalid characters",
        400,
        ErrorCode.BAD_REQUEST,
      );
    }

    const path = req.originalUrl.split("?")[0] ?? req.path;

    const requestHash = createRequestHash(
      req.method,
      path,
      req.params,
      req.body,
    );

    const where = {
      key_userId: {
        key,
        userId: user.id,
      },
    };

    const findExistingRecord = () =>
      prisma.idempotencyRecord.findUnique({
        where,
        select: {
          id: true,
          requestHash: true,
          responseStatus: true,
          responseBody: true,
          expiresAt: true,
        },
      });

    const handleExistingRecord = (
      record: NonNullable<
        Awaited<ReturnType<typeof findExistingRecord>>
      >,
    ): boolean => {
      if (record.requestHash !== requestHash) {
        throw conflict(
          "Idempotency-Key was already used with a different request",
        );
      }

      if (
        record.responseStatus !== null &&
        record.responseBody !== null
      ) {
        sendIdempotentResponse(
          req,
          res,
          record.responseStatus,
          record.responseBody,
        );

        return true;
      }

      throw conflict(
        "A request with this Idempotency-Key is currently being processed",
      );
    };

    for (
      let attempt = 0;
      attempt < MAX_RESERVATION_ATTEMPTS;
      attempt++
    ) {
      const existing = await findExistingRecord();

      if (existing) {
        if (existing.expiresAt <= new Date()) {
          await prisma.idempotencyRecord.deleteMany({
            where: {
              id: existing.id,
              expiresAt: {
                lte: new Date(),
              },
            },
          });

          continue;
        }

        if (handleExistingRecord(existing)) {
          return;
        }
      }

      try {
        const record = await prisma.idempotencyRecord.create({
          data: {
            key,
            userId: user.id,
            requestHash,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
          select: {
            id: true,
          },
        });

        res.locals.idempotencyRecordId = record.id;

        res.once("finish", () => {
          if (res.statusCode >= 400 && res.statusCode < 500) {
            void prisma.idempotencyRecord
              .deleteMany({
                where: {
                  id: record.id,
                  responseStatus: null,
                },
              })
              .catch(() => {});
          }
        });

        next();
        return;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }

        throw error;
      }
    }

    const existing = await findExistingRecord();

    if (existing && existing.expiresAt > new Date()) {
      if (handleExistingRecord(existing)) {
        return;
      }
    }

    throw conflict(
      "Unable to reserve this Idempotency-Key. Please retry the request.",
    );
  } catch (error) {
    next(error);
  }
};

export const completeIdempotencyRecord = async (
  res: Parameters<RequestHandler>[1],
  responseStatus: number,
  responseBody: unknown,
): Promise<void> => {
  const recordId = res.locals.idempotencyRecordId as
    | string
    | undefined;

  if (!recordId) return;

  const jsonSafeBody = JSON.parse(
    JSON.stringify(responseBody),
  ) as Prisma.InputJsonValue;

  await prisma.idempotencyRecord.update({
    where: {
      id: recordId,
    },
    data: {
      responseStatus,
      responseBody: jsonSafeBody,
    },
  });
};

export const clearIdempotencyRecord = async (
  res: Parameters<RequestHandler>[1],
): Promise<void> => {
  const recordId = res.locals.idempotencyRecordId as
    | string
    | undefined;

  if (!recordId) return;

  try {
    await prisma.idempotencyRecord.deleteMany({
      where: {
        id: recordId,
        responseStatus: null,
      },
    });
  } catch {
    // Preserve the original operation error.
  }
};