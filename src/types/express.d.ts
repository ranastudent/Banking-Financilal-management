import type { AuthUser } from "./auth";

declare global {
  namespace Express {
    interface Request {
      requestId: string;

      validatedQuery?: unknown;

      validatedParams?: unknown;

      user?: AuthUser;
    }
  }
}

export {};