-- CreateTable
CREATE TABLE "email_verification_otps" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_verification_otps_user_id_idx" ON "email_verification_otps"("user_id");

-- CreateIndex
CREATE INDEX "email_verification_otps_expires_at_idx" ON "email_verification_otps"("expires_at");

-- AddForeignKey
ALTER TABLE "email_verification_otps" ADD CONSTRAINT "email_verification_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
