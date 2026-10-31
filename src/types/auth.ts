/** Authenticated principal shared by application services. */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  status: string;
}
