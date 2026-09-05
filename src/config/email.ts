import { env } from "./env";

export const emailConfig = {
  host: env.email.smtpHost,
  port: env.email.smtpPort,
  user: env.email.smtpUser,
  password: env.email.smtpPassword,
  from: env.email.from,
  fromName: env.email.fromName,
};