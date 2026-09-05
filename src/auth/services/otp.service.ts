import { prisma } from "../../config/prisma";

import { generateOtp } from "../utils/otp";
import { hashOtp } from "../utils/otpHash";

import { sendRegistrationOtpEmail } from "./email.service";

export const sendRegistrationOtp = async (
  userId: string,
  email: string,
) => {
  // 1. Generate a 6-digit OTP
  const otp = generateOtp();

  // 2. Hash the OTP before storing it
  const otpHash = await hashOtp(otp);

  // 3. OTP expires after 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // 4. Store only the hashed OTP in the database
  await prisma.emailVerificationOtp.create({
    data: {
      userId,
      otpHash,
      expiresAt,
    },
  });

  // 5. Send the plain OTP to the user's email
  await sendRegistrationOtpEmail(email, otp);
};