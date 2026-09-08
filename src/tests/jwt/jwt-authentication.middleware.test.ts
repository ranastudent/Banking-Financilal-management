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

describe("JWT Authentication Middleware", () => {
  const user: AuthUser = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    email: "jwt-test@example.com",
    role: "CUSTOMER",
    status: "ACTIVE",
  };

  const createResponse = (): Response =>
    ({}) as Response;

  const createNext = () =>
    (() => undefined) as NextFunction;

  const createRequest = (
    authorization?: string,
  ): Request => {
    const request = {
      headers: {},
      header(name: string): string | undefined {
        if (name.toLowerCase() === "authorization") {
          return authorization;
        }

        return undefined;
      },
    } as Request;

    return request;
  };

  const createAccessToken = (): string =>
    jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      env.jwtAccessSecret,
      {
        expiresIn: "15m",
      },
    );

  const createRefreshToken = (): string =>
    jwt.sign(
      {
        sub: user.id,
        tokenType: "refresh",
      },
      env.jwtRefreshSecret,
      {
        expiresIn: "7d",
      },
    );

  it("should reject a request without an Authorization header", () => {
    const request = createRequest();
    const response = createResponse();
    const next = createNext();

    expect(() => {
      authenticate(request, response, next);
    }).toThrow("Authentication required");

    expect(request.user).toBeUndefined();
  });

  it("should reject an invalid Authorization header format", () => {
    const request = createRequest("InvalidToken");
    const response = createResponse();
    const next = createNext();

    expect(() => {
      authenticate(request, response, next);
    }).toThrow("Invalid authorization header");

    expect(request.user).toBeUndefined();
  });

  it("should reject an Authorization header without a token", () => {
    const request = createRequest("Bearer");
    const response = createResponse();
    const next = createNext();

    expect(() => {
      authenticate(request, response, next);
    }).toThrow("Invalid authorization header");

    expect(request.user).toBeUndefined();
  });

  it("should reject an invalid access token", () => {
    const request = createRequest(
      "Bearer invalid.jwt.token",
    );
    const response = createResponse();
    const next = createNext();

    expect(() => {
      authenticate(request, response, next);
    }).toThrow("Invalid or expired access token");

    expect(request.user).toBeUndefined();
  });

  it("should reject an expired access token", () => {
    const expiredToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      env.jwtAccessSecret,
      {
        expiresIn: -1,
      },
    );

    const request = createRequest(
      `Bearer ${expiredToken}`,
    );
    const response = createResponse();
    const next = createNext();

    expect(() => {
      authenticate(request, response, next);
    }).toThrow("Invalid or expired access token");

    expect(request.user).toBeUndefined();
  });

  it("should reject a refresh token used as an access token", () => {
    const refreshToken = createRefreshToken();

    const request = createRequest(
      `Bearer ${refreshToken}`,
    );
    const response = createResponse();
    const next = createNext();

    expect(() => {
      authenticate(request, response, next);
    }).toThrow();

    expect(request.user).toBeUndefined();
  });

  it("should reject a token signed with the wrong secret", () => {
    const wrongSecretToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      env.jwtRefreshSecret,
      {
        expiresIn: "15m",
      },
    );

    const request = createRequest(
      `Bearer ${wrongSecretToken}`,
    );
    const response = createResponse();
    const next = createNext();

    expect(() => {
      authenticate(request, response, next);
    }).toThrow("Invalid or expired access token");

    expect(request.user).toBeUndefined();
  });

  it("should authenticate a valid access token", () => {
    const accessToken = createAccessToken();

    const request = createRequest(
      `Bearer ${accessToken}`,
    );
    const response = createResponse();

    let nextCalled = false;

    const next: NextFunction = () => {
      nextCalled = true;
    };

    authenticate(request, response, next);

    expect(nextCalled).toBe(true);

    expect(request.user).toEqual(user);
  });

  it("should correctly attach authenticated user to req.user", () => {
    const accessToken = createAccessToken();

    const request = createRequest(
      `Bearer ${accessToken}`,
    );
    const response = createResponse();

    authenticate(
      request,
      response,
      createNext(),
    );

    expect(request.user).toBeDefined();
    expect(request.user?.id).toBe(user.id);
    expect(request.user?.email).toBe(user.email);
    expect(request.user?.role).toBe(user.role);
    expect(request.user?.status).toBe(user.status);
  });
});