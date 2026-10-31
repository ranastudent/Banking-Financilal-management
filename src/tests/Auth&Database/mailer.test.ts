import { describe, expect, it, vi } from "vitest";

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn().mockResolvedValue({
    messageId: "unit-test-message-id",
  });

  const createTransportMock = vi.fn(() => ({
    sendMail: sendMailMock,
  }));

  return { sendMailMock, createTransportMock };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock,
  },
}));

import { sendEmail } from "../../utils/mailer";

describe("Mailer", () => {
  it("creates the SMTP transport from configuration", () => {
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: expect.any(String),
        port: expect.any(Number),
        secure: expect.any(Boolean),
        auth: {
          user: expect.any(String),
          pass: expect.any(String),
        },
      }),
    );
  });

  it("sends an email with the configured sender and supplied content", async () => {
    await expect(
      sendEmail({
        to: "test-recipient@example.invalid",
        subject: "Banking Platform - Mailer Unit Test",
        html: "<h2>Mailer unit test</h2>",
      }),
    ).resolves.toBeUndefined();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.stringContaining("Banking Platform"),
        to: "test-recipient@example.invalid",
        subject: "Banking Platform - Mailer Unit Test",
        html: "<h2>Mailer unit test</h2>",
      }),
    );
  });
});
