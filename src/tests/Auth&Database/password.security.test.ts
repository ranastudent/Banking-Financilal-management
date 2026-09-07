import { describe, it, expect } from "vitest";
import { hashPassword, comparePassword } from "../../auth/utils/password";

describe("Password Security", () => {
  it("should hash a password instead of storing plaintext", async () => {
    const password = "SecurePassword123!";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).not.toBe(password);
    expect(passwordHash).toHaveLength(60);
  });

  it("should successfully verify the correct password", async () => {
    const password = "SecurePassword123!";
    const passwordHash = await hashPassword(password);

    const result = await comparePassword(password, passwordHash);

    expect(result).toBe(true);
  });

  it("should reject an incorrect password", async () => {
    const password = "SecurePassword123!";
    const wrongPassword = "WrongPassword123!";
    const passwordHash = await hashPassword(password);

    const result = await comparePassword(wrongPassword, passwordHash);

    expect(result).toBe(false);
  });

  it("should generate different hashes for the same password", async () => {
    const password = "SecurePassword123!";

    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2);
  });
});