import type { RiskContext, RiskRule, RiskRuleResult } from "../risk.types";

export class NewBeneficiaryRule implements RiskRule {
  readonly id = "NEW_BENEFICIARY";
  evaluate(context: RiskContext): RiskRuleResult {
    return {
      matched: context.isNewBeneficiary,
      points: context.isNewBeneficiary ? 20 : 0,
      ...(context.isNewBeneficiary ? { reason: {
        ruleId: this.id,
        description: "The recipient account is not present in the sender's saved beneficiary list.",
        points: 20,
      } } : {}),
    };
  }
}
