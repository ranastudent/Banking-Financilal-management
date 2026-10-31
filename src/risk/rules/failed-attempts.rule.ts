import type { RiskContext, RiskRule, RiskRuleResult } from "../risk.types";

export class FailedAttemptsRule implements RiskRule {
  readonly id = "RECENT_FAILED_ATTEMPTS";
  evaluate(context: RiskContext): RiskRuleResult {
    const matched = context.failedAttemptsLastHour >= 3;
    const points = matched ? Math.min(35, 20 + (context.failedAttemptsLastHour - 3) * 5) : 0;
    return {
      matched,
      points,
      ...(matched ? { reason: {
        ruleId: this.id,
        description: "Multiple failed transfers were recorded for this sender during the last hour.",
        points,
        evidence: { failedAttemptsLastHour: context.failedAttemptsLastHour },
      } } : {}),
    };
  }
}
