import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma";
const db = prisma as any;

const customerCopy = (decision: string, fundsMoved: boolean, phase: "PHASE32" | "PHASE33") => {
  if (phase === "PHASE32" && decision === "CANCELLED") return {
    title: "Security review completed",
    message: "The original held transfer request has been closed. The approved transfer, if any, is recorded separately in your transaction history.",
    actions: ["Review your latest transaction history", "Contact support if the new transfer is not visible"],
  };
  if (phase === "PHASE32" && decision === "ON_HOLD") return {
    title: "Transfer temporarily on hold",
    message: "Your transfer is awaiting a security review. The ledger currently shows no posted movement for this transaction. We will notify you when the review is complete.",
    actions: ["Wait for the security review", "Contact support if you did not initiate this transfer"],
  };
  if (phase === "PHASE33" && fundsMoved) return {
    title: "Transaction review in progress",
    message: "Your transaction has ledger postings. Subsequent security monitoring identified activity that requires review. This alert does not itself mean the transaction was stopped or reversed.",
    actions: ["Review your account activity", "Contact support if you do not recognize this transaction"],
  };
  if (decision === "REJECTED") return {
    title: "Transaction not completed",
    message: fundsMoved
      ? "The transaction is marked as rejected, but ledger entries exist. Please contact support while the records are reconciled."
      : "Your transaction was not completed. No ledger posting was found for this transaction.",
    actions: ["Check your available balance", "Contact support if the amount appears unavailable"],
  };
  if (decision === "NEEDS_VERIFICATION") return {
    title: "Additional verification required",
    message: "Additional verification is required before this transaction can proceed. This notice does not confirm that funds have moved.",
    actions: ["Complete verification through the official app"],
  };
  return {
    title: decision === "PROCESSING" ? "Transaction processing" : "Transaction update",
    message: fundsMoved ? "Your transaction has ledger postings. Review the transaction details for its current status." : "Your transaction is being processed. We will update you when its status changes.",
    actions: ["Check transaction history"],
  };
};

export const createDecisionExplanationWithClient = async (client: any, input: {
  transactionId: string; customerId: string; phase: "PHASE32" | "PHASE33" | "SHARED";
  source: string; decision: string; riskAnalysisId?: string; monitoringEventId?: string; fraudAlertId?: string;
}) => {
  const existingForAlert = input.fraudAlertId
    ? await client.transactionDecisionExplanation.findFirst({ where: { fraudAlertId: input.fraudAlertId, decision: input.decision } })
    : null;
  if (existingForAlert) return existingForAlert;
  const [transaction, ledgerCount, previous] = await Promise.all([
    client.transaction.findUnique({ where: { id: input.transactionId }, select: { id: true, status: true, reference: true, amount: true, currencyCode: true } }),
    client.ledgerEntry.count({ where: { transactionId: input.transactionId } }),
    client.transactionDecisionExplanation.findFirst({ where: { transactionId: input.transactionId }, orderBy: { decisionVersion: "desc" } }),
  ]);
  if (!transaction) throw new Error("Transaction not found");
  const fundsMoved = ledgerCount > 0;
  const copy = customerCopy(input.decision, fundsMoved, input.phase === "SHARED" ? "PHASE33" : input.phase);
  const version = (previous?.decisionVersion ?? 0) + 1;
  if (previous) await client.transactionDecisionExplanation.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
  return client.transactionDecisionExplanation.create({
    data: {
      transactionId: input.transactionId, customerId: input.customerId, phase: input.phase,
      source: input.source, decision: input.decision, decisionVersion: version,
      riskAnalysisId: input.riskAnalysisId, monitoringEventId: input.monitoringEventId, fraudAlertId: input.fraudAlertId,
      customerTitle: copy.title, customerMessage: copy.message,
      reasonCodes: [input.phase === "PHASE32" ? "SECURITY_REVIEW" : "MONITORING_REVIEW"],
      requiredActions: copy.actions,
      transactionImpact: { transactionStatus: transaction.status, ledgerEntryCount: ledgerCount, fundsMovementConfirmed: fundsMoved, reference: transaction.reference, amount: transaction.amount.toString(), currencyCode: transaction.currencyCode },
      publicReference: `DEC-${randomUUID().replace(/-/g,"").slice(0,16).toUpperCase()}`,
    },
  });
};

export const createDecisionExplanation = async (input: Parameters<typeof createDecisionExplanationWithClient>[1]) =>
  db.$transaction((tx: any) => createDecisionExplanationWithClient(tx, input));

export const listCustomerDecisionExplanations = async (customerId: string, page = 1, limit = 20) =>
  db.transactionDecisionExplanation.findMany({
    where: { customerId }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: Math.min(limit, 50),
    select: { publicReference: true, phase: true, decision: true, status: true, customerTitle: true, customerMessage: true, reasonCodes: true, requiredActions: true, transactionImpact: true, decisionAt: true, createdAt: true },
  });
