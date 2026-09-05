import bcrypt from "bcrypt";

export const hashOtp = async (otp: string): Promise<string> => {
  return bcrypt.hash(otp, 10);
};

export const compareOtp = async (
  otp: string,
  otpHash: string,
): Promise<boolean> => {
  return bcrypt.compare(otp, otpHash);
};