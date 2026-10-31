/*
  Phase 32.1
  Risk Detection Database Migration

  Existing risk_analyses table was inspected:
  - Existing row count: 0
  - risk_level column type: TEXT
  - No existing risk records require conversion.

  This migration introduces:
  - RiskLevel
  - RiskDecision
  - RiskReviewStatus
  - RiskReviewDecision
  - RiskAnalysis enhancements
  - RiskReview table
*/

-- ============================================================
-- 1. CREATE RISK ENUMS
-- ============================================================

CREATE TYPE "RiskLevel" AS ENUM (
    'LOW',
    'HIGH'
);

CREATE TYPE "RiskDecision" AS ENUM (
    'APPROVE',
    'HOLD'
);

CREATE TYPE "RiskReviewStatus" AS ENUM (
    'NOT_REQUIRED',
    'PENDING',
    'APPROVED',
    'REJECTED'
);

CREATE TYPE "RiskReviewDecision" AS ENUM (
    'APPROVED',
    'REJECTED'
);


-- ============================================================
-- 2. UPDATE TRANSACTION STATUS
-- ============================================================




-- ============================================================
-- 3. CONVERT EXISTING RISK LEVEL COLUMN
-- ============================================================

ALTER TABLE "risk_analyses"
ALTER COLUMN "risk_level" TYPE "RiskLevel"
USING (
    CASE
        WHEN "risk_level" = 'LOW'
            THEN 'LOW'::"RiskLevel"

        WHEN "risk_level" = 'HIGH'
            THEN 'HIGH'::"RiskLevel"

        ELSE NULL
    END
);


-- ============================================================
-- 4. ADD RISK ANALYSIS COLUMNS
-- ============================================================

ALTER TABLE "risk_analyses"

ADD COLUMN "risk_score" INTEGER NOT NULL DEFAULT 0,

ADD COLUMN "decision" "RiskDecision" NOT NULL DEFAULT 'APPROVE',

ADD COLUMN "review_status" "RiskReviewStatus"
    NOT NULL DEFAULT 'NOT_REQUIRED',

ADD COLUMN "engine_version" TEXT
    NOT NULL DEFAULT 'rules-v1',

ADD COLUMN "updated_at" TIMESTAMP(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- ============================================================
-- 5. ADD RISK SCORE VALIDATION
-- ============================================================

ALTER TABLE "risk_analyses"

ADD CONSTRAINT "risk_analyses_risk_score_range_check"

CHECK (
    "risk_score" BETWEEN 0 AND 100
);


-- ============================================================
-- 6. CREATE RISK REVIEWS TABLE
-- ============================================================

CREATE TABLE "risk_reviews" (

    "id" UUID NOT NULL,

    "risk_analysis_id" UUID NOT NULL,

    "reviewer_id" UUID NOT NULL,

    "decision" "RiskReviewDecision" NOT NULL,

    "comment" TEXT,

    "request_id" TEXT,

    "created_at" TIMESTAMP(3)
        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_reviews_pkey"
        PRIMARY KEY ("id")
);


-- ============================================================
-- 7. CREATE RISK ANALYSIS INDEXES
-- ============================================================

CREATE INDEX "risk_analyses_risk_level_analyzed_at_idx"

ON "risk_analyses"("risk_level", "analyzed_at");


CREATE INDEX "risk_analyses_decision_analyzed_at_idx"

ON "risk_analyses"("decision", "analyzed_at");


CREATE INDEX "risk_analyses_review_status_analyzed_at_idx"

ON "risk_analyses"("review_status", "analyzed_at");


-- ============================================================
-- 8. CREATE RISK REVIEW INDEXES
-- ============================================================

CREATE INDEX "risk_reviews_risk_analysis_id_created_at_idx"

ON "risk_reviews"("risk_analysis_id", "created_at");


CREATE INDEX "risk_reviews_reviewer_id_created_at_idx"

ON "risk_reviews"("reviewer_id", "created_at");


CREATE INDEX "risk_reviews_decision_created_at_idx"

ON "risk_reviews"("decision", "created_at");


CREATE INDEX "risk_reviews_request_id_idx"

ON "risk_reviews"("request_id");


-- ============================================================
-- 9. ADD FOREIGN KEYS
-- ============================================================

ALTER TABLE "risk_reviews"

ADD CONSTRAINT "risk_reviews_risk_analysis_id_fkey"

FOREIGN KEY ("risk_analysis_id")

REFERENCES "risk_analyses"("id")

ON DELETE RESTRICT

ON UPDATE CASCADE;


ALTER TABLE "risk_reviews"

ADD CONSTRAINT "risk_reviews_reviewer_id_fkey"

FOREIGN KEY ("reviewer_id")

REFERENCES "users"("id")

ON DELETE RESTRICT

ON UPDATE CASCADE;