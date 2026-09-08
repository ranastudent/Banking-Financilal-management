import {
  describe,
  expect,
  it,
} from "vitest";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import { authenticate } from "../../middleware/authenticate";
import { env } from "../../config/env";
import type { AuthUser } from "../../types/auth";

describe("Attach Authenticated User to Request", () => {
  const user: AuthUser = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    email: "authenticated-user@example.com",
    role: "CUSTOMER",
    status: "ACTIVE",
  };

  const createRequest = (
    authorization?: string,
  ): Request => {
    return {
      header(name: string): string | undefined {
        if (name.toLowerCase() === "authorization") {
          return authorization;
        }

        return undefined;
      },
    } as Request;
  };

  const createResponse = (): Response =>
    ({} as Response);

  const createAccessToken = (): string => {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        tokenType: "access",
      },
      env.jwtAccessSecret,
      {
        expiresIn: "15m",
      },
    );
  };

  it("should attach the authenticated user to req.user", () => {
    const accessToken = createAccessToken();

    const req = createRequest(
      `Bearer ${accessToken}`,
    );

    const res = createResponse();

    let nextCalled = false;

    const next: NextFunction = () => {
      nextCalled = true;
    };

    authenticate(req, res, next);

    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
  });

  it("should attach the correct user id", () => {
    const accessToken = createAccessToken();

    const req = createRequest(
      `Bearer ${accessToken}`,
    );

    const res = createResponse();

    authenticate(
      req,
      res,
      () => undefined,
    );

    expect(req.user?.id).toBe(user.id);
  });

  it("should attach the correct email", () => {
    const accessToken = createAccessToken();

    const req = createRequest(
      `Bearer ${accessToken}`,
    );

    const res = createResponse();

    authenticate(
      req,
      res,
      () => undefined,
    );

    expect(req.user?.email).toBe(user.email);
  });

  it("should attach the correct role", () => {
    const accessToken = createAccessToken();

    const req = createRequest(
      `Bearer ${accessToken}`,
    );

    const res = createResponse();

    authenticate(
      req,
      res,
      () => undefined,
    );

    expect(req.user?.role).toBe(user.role);
  });

  it("should attach the correct account status", () => {
    const accessToken = createAccessToken();

    const req = createRequest(
      `Bearer ${accessToken}`,
    );

    const res = createResponse();

    authenticate(
      req,
      res,
      () => undefined,
    );

    expect(req.user?.status).toBe(user.status);
  });

  it("should attach only the authenticated user fields", () => {
    const accessToken = createAccessToken();

    const req = createRequest(
      `Bearer ${accessToken}`,
    );

    const res = createResponse();

    authenticate(
      req,
      res,
      () => undefined,
    );

    expect(req.user).toEqual({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    expect(req.user).not.toHaveProperty(
      "password",
    );

    expect(req.user).not.toHaveProperty(
      "passwordHash",
    );

    expect(req.user).not.toHaveProperty(
      "refreshToken",
    );
  });
});