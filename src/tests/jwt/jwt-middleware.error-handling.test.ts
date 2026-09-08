import {
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { env } from "../../config/env";

describe("JWT Middleware Error Handling", () => {
  const user = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    email: "jwt-error@example.com",
    role: "CUSTOMER",
    status: "ACTIVE",
  };

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

  const expectUnauthorizedResponse = (
    response: request.Response,
  ): void => {
    expect(response.status).toBe(401);

    expect(response.body.success).toBe(false);

    expect(response.body.error).toBeDefined();

    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );

    expect(response.body.error.message).toBeDefined();

    expect(response.body.requestId).toBeDefined();

    expect(
      typeof response.body.requestId,
    ).toBe("string");
  };

  it("should return a standardized 401 response when Authorization header is missing", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me");

    expectUnauthorizedResponse(response);
  });

  it("should return a standardized 401 response for an invalid Authorization header", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        "Basic abc123",
      );

    expectUnauthorizedResponse(response);
  });

  it("should return a standardized 401 response for an invalid JWT", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      );

    expectUnauthorizedResponse(response);
  });

  it("should return a standardized 401 response for an expired JWT", async () => {
    const expiredToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        tokenType: "access",
      },
      env.jwtAccessSecret,
      {
        expiresIn: -1,
      },
    );

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${expiredToken}`,
      );

    expectUnauthorizedResponse(response);
  });

  it("should return a standardized 401 response for a token signed with the wrong secret", async () => {
    const wrongSecretToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        tokenType: "access",
      },
      env.jwtRefreshSecret,
      {
        expiresIn: "15m",
      },
    );

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${wrongSecretToken}`,
      );

    expectUnauthorizedResponse(response);
  });

  it("should return a standardized 401 response for an invalid access-token payload", async () => {
    const invalidPayloadToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        tokenType: "access",
      },
      env.jwtAccessSecret,
      {
        expiresIn: "15m",
      },
    );

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${invalidPayloadToken}`,
      );

    expectUnauthorizedResponse(response);
  });

  it("should not expose the raw JWT error type", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      );

    expectUnauthorizedResponse(response);

    const responseText = JSON.stringify(
      response.body,
    );

    expect(responseText).not.toContain(
      "JsonWebTokenError",
    );

    expect(responseText).not.toContain(
      "TokenExpiredError",
    );
  });

  it("should not expose a stack trace in the HTTP response", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      );

    expectUnauthorizedResponse(response);

    expect(response.body).not.toHaveProperty(
      "stack",
    );

    expect(response.body.error).not.toHaveProperty(
      "stack",
    );
  });

  it("should not expose the invalid access token in the error response", async () => {
  const invalidToken =
    "eyJ.invalid-sensitive-test-token.signature";

  const response = await request(app)
    .get("/api/v1/auth/me")
    .set(
      "Authorization",
      `Bearer ${invalidToken}`,
    );

  expectUnauthorizedResponse(response);

  const responseText = JSON.stringify(
    response.body,
  );

  expect(responseText).not.toContain(
    invalidToken,
  );
});
});