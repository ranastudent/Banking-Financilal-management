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
    return `[${value
      .map(stableStringify)
      .join(",")}]`;
  }

  const object = value as Record<string, unknown>;

  return `{${Object.keys(object)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(
          object[key],
        )}`,
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

    /*
     * Authentication must happen before idempotency
     * because the record is scoped by userId.
     */
    if (!user) {
      throw new AppError(
        "Authentication is required",
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    /*
     * Read and validate the Idempotency-Key header.
     */
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

    /*
     * HTTP visible ASCII characters only.
     */
    if (!/^[\x21-\x7E]+$/.test(key)) {
      throw new AppError(
        "Idempotency-Key contains invalid characters",
        400,
        ErrorCode.BAD_REQUEST,
      );
    }

    /*
     * Exclude query parameters from the idempotency
     * fingerprint while keeping the route and params.
     */
    const path =
      req.originalUrl.split("?")[0] ??
      req.path;

    /*
     * The same key must represent the same operation.
     */
    const requestHash = createRequestHash(
      req.method,
      path,
      req.params,
      req.body,
    );

    /*
     * Idempotency scope:
     *
     *     Idempotency-Key + User
     *
     * Therefore the same key can be used by
     * different users independently.
     */
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
          key: true,
          userId: true,
          requestHash: true,
          responseStatus: true,
          responseBody: true,
          expiresAt: true,
        },
      });

    let existing =
      await findExistingRecord();

    /*
     * 24-hour TTL handling.
     *
     * expiresAt was already stored before,
     * but it was not previously checked.
     *
     * If an old record has expired, remove it and
     * allow this key to be used again.
     */
    if (
      existing &&
      existing.expiresAt <= new Date()
    ) {
      await prisma.idempotencyRecord.deleteMany({
        where: {
          id: existing.id,
          expiresAt: {
            lte: new Date(),
          },
        },
      });

      /*
       * Re-read after deletion.
       *
       * This also handles a race where another
       * request creates a new record after deletion.
       */
      existing =
        await findExistingRecord();
    }

    /*
     * Existing active record.
     */
    if (existing) {
      /*
       * Same key but different request.
       */
      if (
        existing.requestHash !== requestHash
      ) {
        throw new AppError(
          "Idempotency-Key was already used with a different request",
          409,
          ErrorCode.CONFLICT,
        );
      }

      /*
       * Previous request completed successfully
       * and the original response is available.
       *
       * Return it without executing the financial
       * operation again.
       */
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

      /*
       * A matching request is currently being
       * processed by another request.
       */
      throw new AppError(
        "A request with this Idempotency-Key is currently being processed",
        409,
        ErrorCode.CONFLICT,
      );
    }

    /*
     * No existing record.
     *
     * Create a reservation before the financial
     * operation starts.
     *
     * The database unique constraint protects
     * against concurrent requests using the same
     * key for the same user.
     */
    try {
      const record =
        await prisma.idempotencyRecord.create({
          data: {
            key,
            userId: user.id,
            requestHash,
            expiresAt: new Date(
              Date.now() +
                IDEMPOTENCY_TTL_MS,
            ),
          },
          select: {
            id: true,
          },
        });

      /*
       * The controller will use this ID when
       * completing or clearing the record.
       */
      res.locals.idempotencyRecordId =
        record.id;

      /*
       * If business validation produces a 4xx
       * response, release the reservation so
       * the client can retry.
       *
       * We intentionally keep the record on 5xx.
       * A financial transaction may have committed
       * even if response processing failed.
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
              /*
               * The HTTP response is already complete.
               * Do not change it because cleanup failed.
               */
            });
        }
      });
    } catch (error) {
      /*
       * P2002 means another concurrent request
       * created the same (key, userId) record first.
       */
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrentRecord =
          await prisma.idempotencyRecord.findUnique(
            {
              where,
              select: {
                id: true,
                requestHash: true,
                responseStatus: true,
                responseBody: true,
                expiresAt: true,
              },
            },
          );

        /*
         * The record disappeared between the
         * unique-constraint failure and this lookup.
         * Re-throw the original database error.
         */
        if (!concurrentRecord) {
          throw error;
        }

        /*
         * Same key but different request.
         */
        if (
          concurrentRecord.requestHash !==
          requestHash
        ) {
          throw new AppError(
            "Idempotency-Key was already used with a different request",
            409,
            ErrorCode.CONFLICT,
          );
        }

        /*
         * The first request has completed.
         */
        if (
          concurrentRecord.responseStatus !==
            null &&
          concurrentRecord.responseBody !== null
        ) {
          return sendIdempotentResponse(
            req,
            res,
            concurrentRecord.responseStatus,
            concurrentRecord.responseBody,
          );
        }

        /*
         * The first request is still processing.
         */
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

/*
 * Store the final response on the idempotency record.
 *
 * This allows a later retry using the same key
 * to replay the exact logical response without
 * executing the financial operation again.
 */
export const completeIdempotencyRecord = async (
  res: Parameters<RequestHandler>[1],
  responseStatus: number,
  responseBody: unknown,
): Promise<void> => {
  const recordId =
    res.locals.idempotencyRecordId as
      | string
      | undefined;

  if (!recordId) {
    return;
  }

  const jsonSafeBody =
    JSON.parse(
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

/*
 * Remove the idempotency reservation after a
 * failed business operation when retrying is safe.
 */
export const clearIdempotencyRecord = async (
  res: Parameters<RequestHandler>[1],
): Promise<void> => {
  const recordId =
    res.locals.idempotencyRecordId as
      | string
      | undefined;

  if (!recordId) {
    return;
  }

  try {
    await prisma.idempotencyRecord.delete({
      where: {
        id: recordId,
      },
    });
  } catch {
    /*
     * Never hide the original financial-operation
     * error because cleanup failed.
     */
  }
};