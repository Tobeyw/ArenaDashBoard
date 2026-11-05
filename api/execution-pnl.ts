// Adapted from PrivySpoonPredict/server/src/predict/execution-pnl.ts; keep cost rules aligned.
import Decimal from "decimal.js";

export type ExecutionKind = "BUY" | "SELL" | "SETTLEMENT";

type ExecutionBase = {
  executionId: string;
  orderId: string | null;
  marketId: string;
  tokenId: string;
  kind: ExecutionKind;
  quantity: string;
  positionQuantity?: string;
  value: string;
  fee: string;
  feeTreatment?: "ADDITIVE" | "INCLUDED_IN_VALUE";
  executedAt: string;
};

export type AttributedExecution = ExecutionBase & {
  status: "ATTRIBUTED";
  agentId: string;
  eventId: string;
  modelId: string;
};

export type UnattributedExecution = ExecutionBase & {
  status: "UNATTRIBUTED";
  agentId?: never;
  eventId?: never;
  modelId?: never;
};

export type NormalizedExecution = AttributedExecution | UnattributedExecution;

export type WalletPositionMark = {
  marketId: string;
  tokenId: string;
  openShares: string;
  currentValue: string;
};

export type ExecutionPnlInput = {
  asOf: string;
  executions: readonly NormalizedExecution[];
  walletPositions: readonly WalletPositionMark[];
};

export type ExecutionPnlMetrics = {
  filledQuantity: string;
  grossEntryValue: string;
  attributedCost: string;
  averageEntryPrice: string | null;
  openShares: string;
  openCost: string;
  positionOpenCost: string;
  currentValue: string | null;
  realizedPnl: string;
  unrealizedPnl: string | null;
  totalPnl: string | null;
  roi: string | null;
  fees: string;
  orderCount: number;
};

export type ModelExecutionPnl = {
  modelId: string;
  metrics: ExecutionPnlMetrics;
};

export type EventExecutionPnl = {
  eventId: string;
  metrics: ExecutionPnlMetrics;
  models: ModelExecutionPnl[];
};

export type AgentExecutionPnl = {
  agentId: string;
  metrics: ExecutionPnlMetrics;
  events: EventExecutionPnl[];
};

export type PositionConservation = {
  marketId: string;
  tokenId: string;
  status: "MATCHED" | "MISMATCH" | "MISSING_MARK";
  providerOpenShares: string | null;
  attributedOpenShares: string;
  unattributedOpenShares: string;
  projectedOpenShares: string;
  difference: string | null;
  providerCurrentValue: string | null;
};

export type ExecutionPnlIssue = {
  code: "OVER_DISPOSITION" | "DUPLICATE_POSITION_MARK";
  executionId?: string;
  marketId: string;
  tokenId: string;
};

export type ExecutionPnlProjection = {
  status: "complete" | "partial";
  asOf: string;
  agents: AgentExecutionPnl[];
  unattributed: ExecutionPnlMetrics;
  unattributedExecutionCount: number;
  duplicateExecutionCount: number;
  conservation: PositionConservation[];
  issues: ExecutionPnlIssue[];
};

type Lot = {
  agentId: string | null;
  eventId: string | null;
  modelId: string | null;
  marketId: string;
  tokenId: string;
  filledQuantity: Decimal;
  grossEntryValue: Decimal;
  attributedCost: Decimal;
  openShares: Decimal;
  openCost: Decimal;
  positionOpenCost: Decimal;
  realizedPnl: Decimal;
  fees: Decimal;
  orderIds: Set<string>;
};

type MetricsAccumulator = {
  filledQuantity: Decimal;
  grossEntryValue: Decimal;
  attributedCost: Decimal;
  openShares: Decimal;
  openCost: Decimal;
  positionOpenCost: Decimal;
  currentValue: Decimal;
  currentValueComplete: boolean;
  realizedPnl: Decimal;
  fees: Decimal;
  orderIds: Set<string>;
};

const ZERO = new Decimal(0);
const SHARE_QUANTUM = new Decimal("0.000000000000000001");

/**
 * Projects provider-derived execution PnL without mutating or persisting a
 * financial ledger. BUY value and SELL/SETTLEMENT value are gross provider
 * cash amounts excluding `fee`; BUY fees enter cost basis exactly once.
 */
export function projectExecutionPnl(
  input: ExecutionPnlInput,
): ExecutionPnlProjection {
  const executions = [...input.executions].sort(
    (left, right) =>
      left.executedAt.localeCompare(right.executedAt) ||
      left.executionId.localeCompare(right.executionId),
  );
  const seen = new Set<string>();
  const lots = new Map<string, Lot>();
  const issues: ExecutionPnlIssue[] = [];
  let duplicateExecutionCount = 0;
  let unattributedExecutionCount = 0;

  for (const execution of executions) {
    if (seen.has(execution.executionId)) {
      duplicateExecutionCount += 1;
      continue;
    }
    seen.add(execution.executionId);
    if (execution.status === "UNATTRIBUTED") unattributedExecutionCount += 1;
    applyExecution(lotFor(lots, execution), execution, issues);
  }

  const marks = new Map<string, WalletPositionMark>();
  for (const position of input.walletPositions) {
    const key = positionKey(position.marketId, position.tokenId);
    if (marks.has(key)) {
      issues.push({
        code: "DUPLICATE_POSITION_MARK",
        marketId: position.marketId,
        tokenId: position.tokenId,
      });
      continue;
    }
    assertNonNegative(position.openShares, "wallet position openShares");
    assertNonNegative(position.currentValue, "wallet position currentValue");
    marks.set(key, position);
  }

  const markPrices = new Map<string, Decimal | null>();
  for (const [key, position] of marks) {
    const shares = decimal(position.openShares);
    markPrices.set(
      key,
      shares.eq(ZERO) ? null : decimal(position.currentValue).div(shares),
    );
  }

  const attributedLots = [...lots.values()].filter(
    (lot) => lot.agentId !== null,
  );
  const unattributedLots = [...lots.values()].filter(
    (lot) => lot.agentId === null,
  );
  const agents = buildAgents(attributedLots, markPrices);
  const unattributed = metricsOf(unattributedLots, markPrices);
  const conservation = buildConservation(lots, marks);
  const conservationComplete = conservation.every(
    (item) => item.status === "MATCHED",
  );

  return {
    status:
      issues.length === 0 &&
      unattributedExecutionCount === 0 &&
      conservationComplete
        ? "complete"
        : "partial",
    asOf: input.asOf,
    agents,
    unattributed,
    unattributedExecutionCount,
    duplicateExecutionCount,
    conservation,
    issues,
  };
}

function applyExecution(
  lot: Lot,
  execution: NormalizedExecution,
  issues: ExecutionPnlIssue[],
): void {
  const quantity = assertPositive(execution.quantity, "execution quantity");
  const positionQuantity = assertNonNegative(
    execution.positionQuantity ?? execution.quantity,
    "execution position quantity",
  );
  const value = assertNonNegative(execution.value, "execution value");
  const fee = assertNonNegative(execution.fee, "execution fee");
  const additiveFee =
    execution.feeTreatment === "INCLUDED_IN_VALUE" ? ZERO : fee;
  if (execution.orderId) lot.orderIds.add(execution.orderId);
  lot.fees = lot.fees.plus(fee);

  if (execution.kind === "BUY") {
    lot.filledQuantity = lot.filledQuantity.plus(quantity);
    lot.grossEntryValue = lot.grossEntryValue.plus(value);
    lot.attributedCost = lot.attributedCost.plus(value).plus(additiveFee);
    lot.openShares = lot.openShares.plus(positionQuantity);
    lot.openCost = lot.openCost.plus(value).plus(additiveFee);
    lot.positionOpenCost = lot.positionOpenCost.plus(
      value.times(positionQuantity).div(quantity),
    );
    return;
  }

  // Closure allocations are persisted at 18 decimals; one storage quantum
  // can exceed the remaining lot after proportional allocation rounding.
  const roundingOverflow =
    lot.openShares.gt(ZERO) &&
    quantity.gt(lot.openShares) &&
    quantity.minus(lot.openShares).lte(SHARE_QUANTUM);
  if (quantity.gt(lot.openShares) && !roundingOverflow) {
    issues.push({
      code: "OVER_DISPOSITION",
      executionId: execution.executionId,
      marketId: execution.marketId,
      tokenId: execution.tokenId,
    });
  }
  const consumedQuantity = Decimal.min(quantity, lot.openShares);
  const consumedRatio = roundingOverflow
    ? new Decimal(1)
    : consumedQuantity.div(quantity);
  const allocatedValue = value.times(consumedRatio);
  const allocatedFee = fee.times(consumedRatio);
  const consumedCost = lot.openShares.eq(ZERO)
    ? ZERO
    : lot.openCost.times(consumedQuantity).div(lot.openShares);
  const consumedPositionCost = lot.openShares.eq(ZERO)
    ? ZERO
    : lot.positionOpenCost.times(consumedQuantity).div(lot.openShares);
  lot.openShares = lot.openShares.minus(consumedQuantity);
  lot.openCost = lot.openCost.minus(consumedCost);
  lot.positionOpenCost = lot.positionOpenCost.minus(consumedPositionCost);
  lot.realizedPnl = lot.realizedPnl
    .plus(allocatedValue)
    .minus(consumedCost)
    .minus(allocatedFee);
}

function lotFor(lots: Map<string, Lot>, execution: NormalizedExecution): Lot {
  const identity =
    execution.status === "ATTRIBUTED"
      ? [execution.agentId, execution.eventId, execution.modelId]
      : ["UNATTRIBUTED"];
  const key = [...identity, execution.marketId, execution.tokenId].join(
    "\u0000",
  );
  const existing = lots.get(key);
  if (existing) return existing;
  const created: Lot = {
    agentId: execution.status === "ATTRIBUTED" ? execution.agentId : null,
    eventId: execution.status === "ATTRIBUTED" ? execution.eventId : null,
    modelId: execution.status === "ATTRIBUTED" ? execution.modelId : null,
    marketId: execution.marketId,
    tokenId: execution.tokenId,
    filledQuantity: decimal(0),
    grossEntryValue: decimal(0),
    attributedCost: decimal(0),
    openShares: decimal(0),
    openCost: decimal(0),
    positionOpenCost: decimal(0),
    realizedPnl: decimal(0),
    fees: decimal(0),
    orderIds: new Set(),
  };
  lots.set(key, created);
  return created;
}

function buildAgents(
  lots: Lot[],
  markPrices: ReadonlyMap<string, Decimal | null>,
): AgentExecutionPnl[] {
  const byAgent = groupBy(lots, (lot) => lot.agentId as string);
  return [...byAgent.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([agentId, agentLots]) => {
      const byEvent = groupBy(agentLots, (lot) => lot.eventId as string);
      return {
        agentId,
        metrics: metricsOf(agentLots, markPrices),
        events: [...byEvent.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([eventId, eventLots]) => {
            const byModel = groupBy(eventLots, (lot) => lot.modelId as string);
            return {
              eventId,
              metrics: metricsOf(eventLots, markPrices),
              models: [...byModel.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([modelId, modelLots]) => ({
                  modelId,
                  metrics: metricsOf(modelLots, markPrices),
                })),
            };
          }),
      };
    });
}

function metricsOf(
  lots: readonly Lot[],
  markPrices: ReadonlyMap<string, Decimal | null>,
): ExecutionPnlMetrics {
  const accumulator = lots.reduce<MetricsAccumulator>((result, lot) => {
    result.filledQuantity = result.filledQuantity.plus(lot.filledQuantity);
    result.grossEntryValue = result.grossEntryValue.plus(lot.grossEntryValue);
    result.attributedCost = result.attributedCost.plus(lot.attributedCost);
    result.openShares = result.openShares.plus(lot.openShares);
    result.openCost = result.openCost.plus(lot.openCost);
    result.positionOpenCost = result.positionOpenCost.plus(
      lot.positionOpenCost,
    );
    result.realizedPnl = result.realizedPnl.plus(lot.realizedPnl);
    result.fees = result.fees.plus(lot.fees);
    for (const orderId of lot.orderIds) result.orderIds.add(orderId);
    if (lot.openShares.eq(ZERO)) return result;
    const markPrice = markPrices.get(positionKey(lot.marketId, lot.tokenId));
    if (markPrice === undefined || markPrice === null) {
      result.currentValueComplete = false;
    } else {
      result.currentValue = result.currentValue.plus(
        lot.openShares.times(markPrice),
      );
    }
    return result;
  }, emptyAccumulator());
  const averageEntryPrice = accumulator.filledQuantity.eq(ZERO)
    ? null
    : accumulator.grossEntryValue.div(accumulator.filledQuantity);
  const currentValue = accumulator.currentValueComplete
    ? accumulator.currentValue
    : null;
  const unrealizedPnl = currentValue
    ? currentValue.minus(accumulator.openCost)
    : null;
  const totalPnl = unrealizedPnl
    ? accumulator.realizedPnl.plus(unrealizedPnl)
    : null;
  const roi =
    totalPnl === null || accumulator.attributedCost.eq(ZERO)
      ? null
      : totalPnl.div(accumulator.attributedCost);
  return {
    filledQuantity: output(accumulator.filledQuantity),
    grossEntryValue: output(accumulator.grossEntryValue),
    attributedCost: output(accumulator.attributedCost),
    averageEntryPrice:
      averageEntryPrice === null ? null : output(averageEntryPrice),
    openShares: output(accumulator.openShares),
    openCost: output(accumulator.openCost),
    positionOpenCost: output(accumulator.positionOpenCost),
    currentValue: currentValue === null ? null : output(currentValue),
    realizedPnl: output(accumulator.realizedPnl),
    unrealizedPnl: unrealizedPnl === null ? null : output(unrealizedPnl),
    totalPnl: totalPnl === null ? null : output(totalPnl),
    roi: roi === null ? null : output(roi),
    fees: output(accumulator.fees),
    orderCount: accumulator.orderIds.size,
  };
}

function buildConservation(
  lots: ReadonlyMap<string, Lot>,
  marks: ReadonlyMap<string, WalletPositionMark>,
): PositionConservation[] {
  const keys = new Set(marks.keys());
  for (const lot of lots.values())
    keys.add(positionKey(lot.marketId, lot.tokenId));
  return [...keys].sort().map((key) => {
    const [marketId, tokenId] = splitPositionKey(key);
    let attributed = decimal(0);
    let unattributed = decimal(0);
    for (const lot of lots.values()) {
      if (positionKey(lot.marketId, lot.tokenId) !== key) continue;
      if (lot.agentId === null)
        unattributed = unattributed.plus(lot.openShares);
      else attributed = attributed.plus(lot.openShares);
    }
    const projected = attributed.plus(unattributed);
    const mark = marks.get(key);
    const providerShares = mark ? decimal(mark.openShares) : null;
    const absentClosedPosition = providerShares === null && projected.eq(ZERO);
    const difference = absentClosedPosition
      ? ZERO
      : providerShares
        ? projected.minus(providerShares)
        : null;
    return {
      marketId,
      tokenId,
      status: absentClosedPosition
        ? "MATCHED"
        : providerShares === null
          ? "MISSING_MARK"
          : difference?.eq(ZERO)
            ? "MATCHED"
            : "MISMATCH",
      providerOpenShares:
        providerShares === null
          ? absentClosedPosition
            ? "0"
            : null
          : output(providerShares),
      attributedOpenShares: output(attributed),
      unattributedOpenShares: output(unattributed),
      projectedOpenShares: output(projected),
      difference: difference === null ? null : output(difference),
      providerCurrentValue: mark
        ? output(decimal(mark.currentValue))
        : absentClosedPosition
          ? "0"
          : null,
    };
  });
}

function emptyAccumulator(): MetricsAccumulator {
  return {
    filledQuantity: decimal(0),
    grossEntryValue: decimal(0),
    attributedCost: decimal(0),
    openShares: decimal(0),
    openCost: decimal(0),
    positionOpenCost: decimal(0),
    currentValue: decimal(0),
    currentValueComplete: true,
    realizedPnl: decimal(0),
    fees: decimal(0),
    orderIds: new Set(),
  };
}

function groupBy<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = grouped.get(key) ?? [];
    group.push(value);
    grouped.set(key, group);
  }
  return grouped;
}

function positionKey(marketId: string, tokenId: string): string {
  return `${marketId}\u0000${tokenId}`;
}

function splitPositionKey(key: string): [string, string] {
  const separator = key.indexOf("\u0000");
  return [key.slice(0, separator), key.slice(separator + 1)];
}

function decimal(value: string | number): Decimal {
  return new Decimal(value);
}

function assertPositive(value: string, label: string): Decimal {
  const parsed = decimal(value);
  if (!parsed.isFinite() || parsed.lte(ZERO)) {
    throw new TypeError(`${label} must be a positive decimal string.`);
  }
  return parsed;
}

function assertNonNegative(value: string, label: string): Decimal {
  const parsed = decimal(value);
  if (!parsed.isFinite() || parsed.lt(ZERO)) {
    throw new TypeError(`${label} must be a non-negative decimal string.`);
  }
  return parsed;
}

function output(value: Decimal): string {
  const fixed = value.toFixed(18);
  const normalized = fixed.replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/u, "");
  return normalized === "-0" ? "0" : normalized;
}
