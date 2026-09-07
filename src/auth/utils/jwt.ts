import jwt from "jsonwebtoken";

import { env } from "../../config/env";
import type { AuthUser } from "../../types/auth";

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN = "7d";

export const generateAccessToken = (user: AuthUser): string => {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    env.jwtAccessSecret,
    {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    },
  );
};

export const generateRefreshToken = (user: AuthUser): string => {
  return jwt.sign(
    {
      sub: user.id,
      tokenType: "refresh",
    },
    env.jwtRefreshSecret,
    {
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    },
  );
};