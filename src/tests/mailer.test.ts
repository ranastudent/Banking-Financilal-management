import { describe, expect, it } from "vitest";

import { sendEmail } from "../utils/mailer";

describe("Mailer", () => {
  it("should send an email successfully", async () => {
    await expect(
      sendEmail({
        to: "reduanulislam92665@gmail.com",
        subject: "Banking Platform - SMTP Test",
        html: `
          <h2>SMTP Test Successful</h2>
          <p>This email was sent from the Banking Platform backend.</p>
        `,
      }),
    ).resolves.not.toThrow();
  });
});