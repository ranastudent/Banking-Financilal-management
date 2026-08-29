import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";

const router = Router();

const testSchema = z
  .object({
    email: z.string().trim().email(),
    amount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/)
      .refine((value) => Number(value) > 0, {
        message: "Amount must be greater than zero",
      }),
    currency: z
      .string()
      .trim()
      .length(3)
      .regex(/^[A-Z]{3}$/),
    accountNumber: z
      .string()
      .trim()
      .min(5)
      .max(34)
      .regex(/^[A-Za-z0-9]+$/),
  })
  .strict();

router.post(
  "/body",
  validate({
    body: testSchema,
  }),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: "Validation passed",
      data: req.body,
      requestId: req.requestId,
    });
  },
);

export default router;