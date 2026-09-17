import request from "supertest";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../auth/services/login.service", () => ({
  loginUser: vi.fn(),
}));

import app from "../../app";
import { loginUser } from "../../auth/services/login.service";

describe("Login Controller", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return login result successfully", async () => {
    vi.mocked(loginUser).mockResolvedValue({
      user: {
        id: "11111111-1111-1111-1111-111111111111",
        email: "login-controller@example.com",
        role: "CUSTOMER",
        status: "ACTIVE",
      },
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
    });

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "login-controller@example.com",
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.data).toEqual({
      user: {
        id: "11111111-1111-1111-1111-111111111111",
        email: "login-controller@example.com",
        role: "CUSTOMER",
        status: "ACTIVE",
      },
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
    });

    expect(response.body.requestId).toBeDefined();

    expect(loginUser).toHaveBeenCalledTimes(1);

    expect(loginUser).toHaveBeenCalledWith({
      email: "login-controller@example.com",
      password: "StrongPassword123!",
    });
  });
});