export type RiskLevel = "LOW" | "HIGH";
export type RiskDecision = "APPROVE" | "HOLD";

export interface RiskReason {
  ruleId: string;
  description: string;
  points: number;
  evidence?: Record<string, string | number | boolean | null>;
}

export interface RiskContext {
  userId: string;
  senderAccountId: string;
  receiverAccountId: string;
  receiverAccountNumber: string;
  amount: number;
  currency: string;
  isNewBeneficiary: boolean;
  failedAttemptsLastHour: number;
  transfersLastHour: number;
  transfersLastMinute: number;
  averageCompletedTransferAmount: number | null;
  hourOfDay: number;
}

export interface RiskRuleResult {
  matched: boolean;
  points: number;
  reason?: RiskReason;
}

export interface RiskRule {
  readonly id: string;
  evaluate(context: RiskContext): RiskRuleResult | Promise<RiskRuleResult>;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  decision: RiskDecision;
  reasons: RiskReason[];
  engineVersion: string;
}
