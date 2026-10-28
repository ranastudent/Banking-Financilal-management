import { readFileSync } from "node:fs";
import { join } from "node:path";
import swaggerUi from "swagger-ui-express";

// The API specification is kept in the repository-level docs directory.
// Run the application from the backend project root so this path resolves.
const openApiPath = join(process.cwd(), "docs", "openapi.json");
export const openApiSpec = JSON.parse(readFileSync(openApiPath, "utf8"));
export const swaggerUiMiddleware = swaggerUi;
