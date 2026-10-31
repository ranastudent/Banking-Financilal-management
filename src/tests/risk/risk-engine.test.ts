import { describe, expect, it } from "vitest";
import { RuleBasedRiskEngine } from "../../risk/risk.engine";
import type { RiskContext, RiskRule } from "../../risk/risk.types";

const context = (overrides: Partial<RiskContext> = {}): RiskContext => ({
  userId: "user-1",
  senderAccountId: "account-1",
  receiverAccountId: "account-2",
  receiverAccountNumber: "2000000001",
  amount: 1000,
  currency: "BDT",
  isNewBeneficiary: false,
  failedAttemptsLastHour: 0,
  transfersLastHour: 1,
  transfersLastMinute: 1,
  averageCompletedTransferAmount: 900,
  hourOfDay: 12,
  ...overrides,
});

describe("RuleBasedRiskEngine", () => {
  it("approves a normal low-risk transfer", async () => {
    const result = await new RuleBasedRiskEngine().assess(context());
    expect(result).toMatchObject({ score: 0, level: "LOW", decision: "APPROVE", engineVersion: "rules-v1" });
  });

  it("holds a large transfer to a new beneficiary", async () => {
    const result = await new RuleBasedRiskEngine().assess(context({ amount: 150000, isNewBeneficiary: true }));
    expect(result.score).toBe(80);
    expect(result.level).toBe("HIGH");
    expect(result.decision).toBe("HOLD");
    expect(result.reasons).toHaveLength(3);
  });

  it("caps risk score at 100", async () => {
    const result = await new RuleBasedRiskEngine().assess(context({
      amount: 200000,
      isNewBeneficiary: true,
      failedAttemptsLastHour: 5,
      transfersLastHour: 10,
      transfersLastMinute: 4,
      averageCompletedTransferAmount: 100,
      hourOfDay: 2,
    }));
    expect(result.score).toBe(100);
    expect(result.decision).toBe("HOLD");
  });

  it("supports custom extensible rule contracts", async () => {
    const customRule: RiskRule = {
      id: "CUSTOM_TEST_RULE",
      evaluate: () => ({ matched: true, points: 60, reason: { ruleId: "CUSTOM_TEST_RULE", description: "custom", points: 60 } }),
    };
    const result = await new RuleBasedRiskEngine([customRule]).assess(context());
    expect(result.decision).toBe("HOLD");
    expect(result.reasons[0]?.ruleId).toBe("CUSTOM_TEST_RULE");
  });
});
