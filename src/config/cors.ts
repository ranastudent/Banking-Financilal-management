import cors, { CorsOptions } from "cors";
import { env } from "./env";

const allowedOrigins = env.corsOrigins;

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests that don't contain an Origin header.
    // Useful for Postman, server-to-server requests, health checks, etc.
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS origin not allowed"));
  },

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Request-ID",
  ],

  credentials: true,
};

export const corsMiddleware = cors(corsOptions);