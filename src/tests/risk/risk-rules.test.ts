import { describe, expect, it } from "vitest";
import { LargeTransferRule } from "../../risk/rules/large-transfer.rule";
import { VelocityRule } from "../../risk/rules/velocity.rule";
import { NewBeneficiaryRule } from "../../risk/rules/new-beneficiary.rule";
import { FailedAttemptsRule } from "../../risk/rules/failed-attempts.rule";
import { UnusualPatternRule } from "../../risk/rules/unusual-pattern.rule";
import type { RiskContext } from "../../risk/risk.types";

const base: RiskContext = {
  userId: "u1", senderAccountId: "a1", receiverAccountId: "a2",
  receiverAccountNumber: "2000000002", amount: 500, currency: "BDT",
  isNewBeneficiary: false, failedAttemptsLastHour: 0, transfersLastHour: 1,
  transfersLastMinute: 1, averageCompletedTransferAmount: 500, hourOfDay: 12,
};

describe("Phase 32 risk rules", () => {
  it("flags large transfers at the configured threshold", () => {
    expect(new LargeTransferRule().evaluate({ ...base, amount: Number(process.env.RISK_LARGE_TRANSFER_THRESHOLD ?? 100000) }).matched).toBe(true);
  });
  it("flags rapid and frequent transfer velocity", () => {
    expect(new VelocityRule().evaluate({ ...base, transfersLastMinute: 3 }).matched).toBe(true);
    expect(new VelocityRule().evaluate({ ...base, transfersLastHour: 8 }).matched).toBe(true);
  });
  it("flags recipients not saved as beneficiaries", () => {
    expect(new NewBeneficiaryRule().evaluate({ ...base, isNewBeneficiary: true }).points).toBe(20);
  });
  it("flags repeated recent failed attempts", () => {
    expect(new FailedAttemptsRule().evaluate({ ...base, failedAttemptsLastHour: 3 }).matched).toBe(true);
  });
  it("flags unusual amount spikes and early-hour transfers", () => {
    expect(new UnusualPatternRule().evaluate({ ...base, amount: 1500 }).matched).toBe(true);
    expect(new UnusualPatternRule().evaluate({ ...base, amount: 25000, hourOfDay: 2 }).matched).toBe(true);
  });
});
