import type { RiskAssessment, RiskContext, RiskRule } from "./risk.types";
import { LargeTransferRule } from "./rules/large-transfer.rule";
import { VelocityRule } from "./rules/velocity.rule";
import { NewBeneficiaryRule } from "./rules/new-beneficiary.rule";
import { FailedAttemptsRule } from "./rules/failed-attempts.rule";
import { UnusualPatternRule } from "./rules/unusual-pattern.rule";

export class RuleBasedRiskEngine {
  constructor(
    private readonly rules: RiskRule[] = [
      new LargeTransferRule(),
      new VelocityRule(),
      new NewBeneficiaryRule(),
      new FailedAttemptsRule(),
      new UnusualPatternRule(),
    ],
    private readonly holdThreshold = 60,
  ) {}

  async assess(context: RiskContext): Promise<RiskAssessment> {
    const results = await Promise.all(this.rules.map((rule) => rule.evaluate(context)));
    const reasons = results.flatMap((result) => result.matched && result.reason ? [result.reason] : []);
    const score = Math.min(100, results.reduce((total, result) => total + result.points, 0));
    const high = score >= this.holdThreshold;
    return {
      score,
      level: high ? "HIGH" : "LOW",
      decision: high ? "HOLD" : "APPROVE",
      reasons,
      engineVersion: "rules-v1",
    };
  }
}

export const riskEngine = new RuleBasedRiskEngine();
