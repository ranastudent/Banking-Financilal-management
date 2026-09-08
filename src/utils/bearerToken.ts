export const extractBearerToken = (
  authorization?: string,
): string => {
  if (!authorization) {
    throw new Error("Authentication required");
  }

  const parts = authorization.trim().split(/\s+/);

  if (
    parts.length !== 2 ||
    parts[0]?.toLowerCase() !== "bearer" ||
    !parts[1]
  ) {
    throw new Error("Invalid authorization header");
  }

  return parts[1];
};