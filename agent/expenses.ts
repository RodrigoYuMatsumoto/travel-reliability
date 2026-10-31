import { Ajv2020 } from 'ajv/dist/2020.js';
import { AppError } from '../api/src/errors.js';

const MAX_MINOR = Number.MAX_SAFE_INTEGER;
const MAX_TOTAL = BigInt(MAX_MINOR);
const householdId = { type: 'string', pattern: '^N[0-9]{2,4}$' } as const;

/**
 * Reconcile known, already-incurred expenses in one currency. One payer is
 * recorded per item. Multiple payers require caller-approved separate accounting
 * items reconciled to the receipt; changing item granularity can change rounding.
 * Original-bill grouping is not inferred. No FX, unknown-cost
 * estimation, reimbursement execution, payment provider or persistence exists.
 * Caller confirmation of the weights is declared, not independently verified.
 * At most 100 households, 500 expenses and 500 declared prior internal transfers
 * are accepted. Empty expenses mean explicitly recorded zero vendor spending;
 * absent/unknown expenses are rejected. Prior transfers adjust only residual
 * balances; their history array is also required ([] explicitly declares none).
 * They never increase vendor spending. Vendor refunds/negative expenses are outside
 * this contract. Totals and individual/residual balances must be safe integers.
 * Per-item
 * shares use largest remainder, then ASCII household-ID order. Only compact
 * household totals and proposed transfers are returned (maximum 64 KiB).
 */
export const expenseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tripKey', 'currency', 'households', 'expenses', 'priorSettlements', 'acceptedRule'],
  properties: {
    tripKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    acceptedRule: { const: true },
    households: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: householdId,
    },
    expenses: {
      type: 'array',
      minItems: 0,
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'amountMinor', 'paidBy', 'beneficiaries'],
        properties: {
          id: { type: 'string', pattern: '^E[0-9]{2,6}$' },
          amountMinor: { type: 'integer', minimum: 0, maximum: MAX_MINOR },
          paidBy: householdId,
          beneficiaries: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['householdId', 'weight'],
              properties: {
                householdId,
                weight: { type: 'integer', minimum: 1, maximum: 1000000 },
              },
            },
          },
        },
      },
    },
    priorSettlements: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'from', 'to', 'amountMinor'],
        properties: {
          id: { type: 'string', pattern: '^T[0-9]{2,6}$' },
          from: householdId,
          to: householdId,
          amountMinor: { type: 'integer', minimum: 0, maximum: MAX_MINOR },
        },
      },
    },
  },
} as const;

interface ExpenseInput {
  tripKey: string;
  currency: string;
  acceptedRule: true;
  households: string[];
  expenses: {
    id: string;
    amountMinor: number;
    paidBy: string;
    beneficiaries: { householdId: string; weight: number }[];
  }[];
  priorSettlements: { id: string; from: string; to: string; amountMinor: number }[];
}

const ajv = new Ajv2020({ strict: true, allErrors: false, ownProperties: true });
const validate = ajv.compile(expenseSchema);
const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function reject(code = 'INVALID_EXPENSE_INPUT'): never {
  throw new AppError(code, 422);
}

/** Reject non-JSON objects/properties without reflecting caller data in errors. */
function assertJsonInput(input: unknown): void {
  const stack = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 180000 || depth > 8) reject();
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'string') {
      if (value.length > 80) reject();
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) reject();
      continue;
    }
    if (typeof value !== 'object') reject();
    const proto = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (proto !== Array.prototype || value.length > 500) reject();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(descriptors).length !== value.length + 1) reject();
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) reject();
        stack.push({ value: descriptor.value, depth: depth + 1 });
      }
    } else {
      if (proto !== Object.prototype && proto !== null) reject();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.length > 8) reject();
      for (const key of keys) {
        if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))
          reject();
        const descriptor = descriptors[key]!;
        if (!('value' in descriptor) || !descriptor.enumerable) reject();
        stack.push({ value: descriptor.value, depth: depth + 1 });
      }
    }
  }
}

export function settleExpenses(input: unknown) {
  assertJsonInput(input);
  if (!validate(input)) reject();
  const supplied = input as ExpenseInput;
  const ids = [...supplied.households].sort(compareId);
  const accounts = new Map(
    ids.map((id) => [id, { paid: 0n, share: 0n, priorSent: 0n, priorReceived: 0n }]),
  );
  const expenseIds = new Set<string>();
  let total = 0n;

  for (const expense of supplied.expenses) {
    if (expenseIds.has(expense.id)) reject('DUPLICATE_EXPENSE_ID');
    expenseIds.add(expense.id);
    const payer = accounts.get(expense.paidBy);
    if (!payer) reject('EXPENSE_HOUSEHOLD_REFERENCE');
    const amount = BigInt(expense.amountMinor);
    total += amount;
    if (total > MAX_TOTAL) reject('EXPENSE_TOTAL_OVERFLOW');
    payer.paid += amount;
    const beneficiaries = new Set<string>();
    for (const beneficiary of expense.beneficiaries) {
      if (!accounts.has(beneficiary.householdId)) reject('EXPENSE_HOUSEHOLD_REFERENCE');
      if (beneficiaries.has(beneficiary.householdId)) reject('DUPLICATE_BENEFICIARY');
      beneficiaries.add(beneficiary.householdId);
    }
    const weightTotal = expense.beneficiaries.reduce((sum, row) => sum + BigInt(row.weight), 0n);
    const shares = expense.beneficiaries.map((row) => {
      const numerator = amount * BigInt(row.weight);
      return {
        id: row.householdId,
        share: numerator / weightTotal,
        remainder: numerator % weightTotal,
      };
    });
    let remaining = amount - shares.reduce((sum, row) => sum + row.share, 0n);
    shares.sort((left, right) =>
      left.remainder === right.remainder
        ? compareId(left.id, right.id)
        : left.remainder > right.remainder
          ? -1
          : 1,
    );
    for (const row of shares) {
      if (remaining > 0n) {
        row.share++;
        remaining--;
      }
      accounts.get(row.id)!.share += row.share;
    }
    if (remaining !== 0n) reject('EXPENSE_RECONCILIATION_FAILED');
  }

  const priorSettlements = supplied.priorSettlements;
  const priorIds = new Set<string>();
  let priorTotal = 0n;
  for (const prior of priorSettlements) {
    if (priorIds.has(prior.id)) reject('DUPLICATE_PRIOR_SETTLEMENT_ID');
    priorIds.add(prior.id);
    const sender = accounts.get(prior.from);
    const recipient = accounts.get(prior.to);
    if (!sender || !recipient) reject('EXPENSE_HOUSEHOLD_REFERENCE');
    if (prior.from === prior.to) reject('PRIOR_SETTLEMENT_SELF_TRANSFER');
    const amount = BigInt(prior.amountMinor);
    priorTotal += amount;
    if (priorTotal > MAX_TOTAL) reject('PRIOR_SETTLEMENT_TOTAL_OVERFLOW');
    sender.priorSent += amount;
    recipient.priorReceived += amount;
  }

  const balances = ids.map((householdId) => {
    const account = accounts.get(householdId)!;
    const balance = account.paid - account.share + account.priorSent - account.priorReceived;
    if (balance > MAX_TOTAL || balance < -MAX_TOTAL) reject('EXPENSE_BALANCE_OVERFLOW');
    return {
      householdId,
      paidMinor: Number(account.paid),
      shareMinor: Number(account.share),
      priorSentMinor: Number(account.priorSent),
      priorReceivedMinor: Number(account.priorReceived),
      balanceMinor: Number(balance),
    };
  });
  const paidTotal = [...accounts.values()].reduce((sum, row) => sum + row.paid, 0n);
  const allocatedTotal = [...accounts.values()].reduce((sum, row) => sum + row.share, 0n);
  const sentTotal = [...accounts.values()].reduce((sum, row) => sum + row.priorSent, 0n);
  const receivedTotal = [...accounts.values()].reduce((sum, row) => sum + row.priorReceived, 0n);
  const netTotal = [...accounts.values()].reduce(
    (sum, row) => sum + row.paid - row.share + row.priorSent - row.priorReceived,
    0n,
  );
  const positiveTotal = balances.reduce(
    (sum, row) => sum + (row.balanceMinor > 0 ? BigInt(row.balanceMinor) : 0n),
    0n,
  );
  if (positiveTotal > MAX_TOTAL) reject('EXPENSE_BALANCE_OVERFLOW');
  if (
    paidTotal !== total ||
    allocatedTotal !== total ||
    sentTotal !== priorTotal ||
    receivedTotal !== priorTotal ||
    netTotal !== 0n
  )
    reject('EXPENSE_RECONCILIATION_FAILED');

  const debtors = balances
    .filter((row) => row.balanceMinor < 0)
    .map((row) => ({ id: row.householdId, amount: -BigInt(row.balanceMinor) }));
  const creditors = balances
    .filter((row) => row.balanceMinor > 0)
    .map((row) => ({ id: row.householdId, amount: BigInt(row.balanceMinor) }));
  const settlements: { from: string; to: string; amountMinor: number }[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex]!;
    const creditor = creditors[creditorIndex]!;
    const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;
    settlements.push({ from: debtor.id, to: creditor.id, amountMinor: Number(amount) });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0n) debtorIndex++;
    if (creditor.amount === 0n) creditorIndex++;
  }
  if (debtors.some((row) => row.amount !== 0n) || creditors.some((row) => row.amount !== 0n))
    reject('EXPENSE_RECONCILIATION_FAILED');
  if (settlements.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== positiveTotal)
    reject('EXPENSE_RECONCILIATION_FAILED');

  const result = {
    tripKey: supplied.tripKey,
    currency: supplied.currency,
    expenseCount: supplied.expenses.length,
    totalExpensesMinor: Number(total),
    priorSettlementCount: priorSettlements.length,
    totalPriorSettlementsMinor: Number(priorTotal),
    totalResidualSettlementMinor: Number(positiveTotal),
    roundingPolicy: 'per_expense_largest_remainder_then_ascii_household_id',
    balanceConvention: 'positive_receive_negative_pay',
    acceptedRule: 'declared_by_caller_not_independently_verified',
    priorSettlementsStatus: 'declared_by_caller_not_independently_verified',
    balances,
    settlements,
    transfersExecuted: false,
    settlementsAreSuggestions: true,
    reconciliation: {
      paidMinor: Number(paidTotal),
      allocatedMinor: Number(allocatedTotal),
      priorSentMinor: Number(sentTotal),
      priorReceivedMinor: Number(receivedTotal),
      balanceMinor: 0,
    },
    notice:
      'Declared prior internal transfers and proposed residual reimbursements are not new vendor expenses. No transfer or payment has been executed by this tool. Vendor refunds/negative expenses are outside this contract. Changing expense-item granularity can change rounding.',
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536) reject('EXPENSE_OUTPUT_LIMIT');
  return result;
}
