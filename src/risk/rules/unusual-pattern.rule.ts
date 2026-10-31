import type { RiskContext, RiskRule, RiskRuleResult } from "../risk.types";

export class UnusualPatternRule implements RiskRule {
  readonly id = "UNUSUAL_TRANSFER_PATTERN";
  evaluate(context: RiskContext): RiskRuleResult {
    const average = context.averageCompletedTransferAmount;
    const amountSpike = average !== null && average > 0 && context.amount >= average * 3;
    const unusualHour = context.hourOfDay >= 0 && context.hourOfDay < 5 && context.amount >= 25000;
    const matched = amountSpike || unusualHour;
    const points = amountSpike && unusualHour ? 30 : matched ? 20 : 0;
    return {
      matched,
      points,
      ...(matched ? { reason: {
        ruleId: this.id,
        description: "Transfer amount or timing differs materially from the sender's recent activity pattern.",
        points,
        evidence: {
          amount: context.amount,
          averageCompletedTransferAmount: average,
          hourOfDay: context.hourOfDay,
          amountSpike,
          unusualHour,
        },
      } } : {}),
    };
  }
}
