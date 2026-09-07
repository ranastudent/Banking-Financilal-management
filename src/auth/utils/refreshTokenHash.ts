import { createHash } from "crypto";

export const hashRefreshToken = (token: string): string => {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
};