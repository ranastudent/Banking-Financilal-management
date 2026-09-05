import { sendEmail } from "../../utils/mailer";

export const sendRegistrationOtpEmail = async (
  email: string,
  otp: string,
) => {
  await sendEmail({
    to: email,
    subject: "Verify your Banking Platform account",
    html: `
      <div>
        <h2>Email Verification</h2>

        <p>
          Thank you for registering with Banking Platform.
        </p>

        <p>
          Your email verification OTP is:
        </p>

        <h1>${otp}</h1>

        <p>
          This OTP is valid for 10 minutes.
        </p>

        <p>
          If you did not create this account, please ignore this email.
        </p>
      </div>
    `,
  });
};