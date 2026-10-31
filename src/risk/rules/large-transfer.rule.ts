import type { RiskContext, RiskRule, RiskRuleResult } from "../risk.types";

const configuredThreshold = Number(process.env.RISK_LARGE_TRANSFER_THRESHOLD ?? 25000);
const LARGE_TRANSFER_THRESHOLD = Number.isFinite(configuredThreshold) && configuredThreshold > 0
  ? configuredThreshold
  : 25000;

export class LargeTransferRule implements RiskRule {
  readonly id = "LARGE_TRANSFER";

  evaluate(context: RiskContext): RiskRuleResult {
    const matched = context.amount >= LARGE_TRANSFER_THRESHOLD;
    return {
      matched,
      points: matched ? 40 : 0,
      ...(matched ? { reason: {
        ruleId: this.id,
        description: "Transfer amount meets or exceeds the configured large-transfer threshold.",
        points: 40,
        evidence: { amount: context.amount, threshold: LARGE_TRANSFER_THRESHOLD, currency: context.currency },
      } } : {}),
    };
  }
}
