import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  createAccount,
} from "../controllers/account.controller";

import {
  getAccounts,
  getAccount,
} from "../controllers/account.controller";

import {
  createAccountSchema,
} from "../schemas/account.schema";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("CUSTOMER"),
  validate({
    body: createAccountSchema,
  }),
  createAccount,
);

router.get(
  "/",
  authenticate,
  authorize("CUSTOMER"),
  getAccounts,
);

router.get(
  "/:accountId",
  authenticate,
  authorize("CUSTOMER"),
  getAccount,
);

export default router;