import { Request, Response, NextFunction } from "express";
import { ZodType } from "zod";

type ValidationSchemas = {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
};

export const validate = (schemas: ValidationSchemas) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (schemas.body) {
      req.body = schemas.body.parse(req.body);
    }

    if (schemas.query) {
       schemas.query.parse(req.query);
    }

    if (schemas.params) {
       schemas.params.parse(req.params);
    }

    next();
  };
};