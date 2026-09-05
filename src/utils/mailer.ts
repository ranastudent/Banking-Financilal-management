import nodemailer from "nodemailer";

import { emailConfig } from "../config/email";

const transporter = nodemailer.createTransport({
  host: emailConfig.host,
  port: emailConfig.port,
  secure: emailConfig.port === 465,

  auth: {
    user: emailConfig.user,
    pass: emailConfig.password,
  },
});

export const sendEmail = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) => {
  await transporter.sendMail({
    from: `"${emailConfig.fromName}" <${emailConfig.from}>`,
    to,
    subject,
    html,
  });
};