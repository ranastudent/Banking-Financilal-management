import { Router } from "express";
import { register } from "../controllers/auth.controller";
import { registerSchema } from "../schemas/auth.schema";
import { validate } from "../../middleware/validate";

const router = Router();

router.post(
  "/register",
  validate({
    body: registerSchema,
  }),
  register,
);

export default router;