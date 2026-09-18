import { createHash } from "crypto";
import type { RequestHandler } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../config/prisma";
import { AppError } from "../errors/AppError";
import { ErrorCode } from "../errors/errorCodes";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const stableStringify = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
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
  const payload = stableStringify({
    method,
    path,
    params,
    body,
  });

  return createHash("sha256")
    .update(payload)
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

    const existing = await prisma.idempotencyRecord.findUnique({
      where,
      select: {
        id: true,
        key: true,
        userId: true,
        requestHash: true,
        responseStatus: true,
        responseBody: true,
        expiresAt: true,
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          "Idempotency-Key was already used with a different request",
          409,
          ErrorCode.CONFLICT,
        );
      }

      if (
        existing.responseStatus !== null &&
        existing.responseBody !== null
      ) {
        return sendIdempotentResponse(
          req,
          res,
          existing.responseStatus,
          existing.responseBody,
        );
      }

      throw new AppError(
        "A request with this Idempotency-Key is currently being processed",
        409,
        ErrorCode.CONFLICT,
      );
    }

    try {
      const record = await prisma.idempotencyRecord.create({
        data: {
          key,
          userId: user.id,
          requestHash,
          expiresAt: new Date(
            Date.now() + IDEMPOTENCY_TTL_MS,
          ),
        },
        select: {
          id: true,
        },
      });

      res.locals.idempotencyRecordId = record.id;

      /*
       * If business validation fails after the reservation is created,
       * remove the reservation so the client can retry.
       *
       * We intentionally do NOT delete on 5xx because a successful
       * financial transaction may already have committed before a
       * response-storage problem occurs.
       */
      res.once("finish", () => {
        if (
          res.statusCode >= 400 &&
          res.statusCode < 500
        ) {
          void prisma.idempotencyRecord
            .delete({
              where: {
                id: record.id,
              },
            })
            .catch(() => {
              // Do not alter the already completed HTTP response.
            });
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrentRecord =
          await prisma.idempotencyRecord.findUnique({
            where,
            select: {
              requestHash: true,
              responseStatus: true,
              responseBody: true,
            },
          });

        if (!concurrentRecord) {
          throw error;
        }

        if (
          concurrentRecord.requestHash !== requestHash
        ) {
          throw new AppError(
            "Idempotency-Key was already used with a different request",
            409,
            ErrorCode.CONFLICT,
          );
        }

        if (
          concurrentRecord.responseStatus !== null &&
          concurrentRecord.responseBody !== null
        ) {
          return sendIdempotentResponse(
            req,
            res,
            concurrentRecord.responseStatus,
            concurrentRecord.responseBody,
          );
        }

        throw new AppError(
          "A request with this Idempotency-Key is currently being processed",
          409,
          ErrorCode.CONFLICT,
        );
      }

      throw error;
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const completeIdempotencyRecord = async (
  res: Parameters<RequestHandler>[1],
  responseStatus: number,
  responseBody: unknown,
) => {
  const recordId = res.locals.idempotencyRecordId as
    | string
    | undefined;

  if (!recordId) {
    return;
  }

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