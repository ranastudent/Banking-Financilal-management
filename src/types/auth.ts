export type SafeUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
};

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  status: string;
};