import type { RiskContext, RiskRule, RiskRuleResult } from "../risk.types";

export class VelocityRule implements RiskRule {
  readonly id = "TRANSFER_VELOCITY";
  evaluate(context: RiskContext): RiskRuleResult {
    const rapid = context.transfersLastMinute >= 3;
    const frequent = context.transfersLastHour >= 8;
    const matched = rapid || frequent;
    const points = rapid && frequent ? 40 : matched ? 35 : 0;
    return {
      matched,
      points,
      ...(matched ? { reason: {
        ruleId: this.id,
        description: "Transfer frequency exceeds the configured rapid-transfer or hourly velocity threshold.",
        points,
        evidence: { transfersLastMinute: context.transfersLastMinute, transfersLastHour: context.transfersLastHour },
      } } : {}),
    };
  }
}
