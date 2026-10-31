import { describe, expect, it, vi } from 'vitest';
import { settleExpenses } from '../agent/expenses.js';

const draft = () => ({
  tripKey: 'demo-1',
  currency: 'BRL',
  households: ['N01', 'N02'],
  acceptedRule: true,
  priorSettlements: [],
  expenses: [
    {
      id: 'E01',
      amountMinor: 12000,
      paidBy: 'N01',
      beneficiaries: [
        { householdId: 'N01', weight: 1 },
        { householdId: 'N02', weight: 1 },
      ],
    },
  ],
});
const prior = (amountMinor = 6000) => ({ id: 'T01', from: 'N02', to: 'N01', amountMinor });

describe('known-expense settlement', () => {
  it('settles an accepted equal split without destination, dates or fabricated booking details', () => {
    const result = settleExpenses(draft());
    expect(result.balances).toEqual([
      {
        householdId: 'N01',
        paidMinor: 12000,
        shareMinor: 6000,
        priorSentMinor: 0,
        priorReceivedMinor: 0,
        balanceMinor: 6000,
      },
      {
        householdId: 'N02',
        paidMinor: 0,
        shareMinor: 6000,
        priorSentMinor: 0,
        priorReceivedMinor: 0,
        balanceMinor: -6000,
      },
    ]);
    expect(result.settlements).toEqual([{ from: 'N02', to: 'N01', amountMinor: 6000 }]);
    expect(result.totalExpensesMinor).toBe(12000);
    expect(result.reconciliation).toEqual({
      paidMinor: 12000,
      allocatedMinor: 12000,
      priorSentMinor: 0,
      priorReceivedMinor: 0,
      balanceMinor: 0,
    });
    expect(result.transfersExecuted).toBe(false);
    expect(result.settlementsAreSuggestions).toBe(true);
    expect(result.acceptedRule).toBe('declared_by_caller_not_independently_verified');
    expect(result.priorSettlementsStatus).toBe('declared_by_caller_not_independently_verified');
  });

  it('deducts an already-declared complete settlement without charging it again or counting it as vendor expense', () => {
    const result = settleExpenses({ ...draft(), priorSettlements: [prior()] });
    expect(result.balances).toEqual([
      {
        householdId: 'N01',
        paidMinor: 12000,
        shareMinor: 6000,
        priorSentMinor: 0,
        priorReceivedMinor: 6000,
        balanceMinor: 0,
      },
      {
        householdId: 'N02',
        paidMinor: 0,
        shareMinor: 6000,
        priorSentMinor: 6000,
        priorReceivedMinor: 0,
        balanceMinor: 0,
      },
    ]);
    expect(result.settlements).toEqual([]);
    expect(result.totalExpensesMinor).toBe(12000);
    expect(result.totalPriorSettlementsMinor).toBe(6000);
    expect(result.totalResidualSettlementMinor).toBe(0);
    expect(result.priorSettlementCount).toBe(1);
    expect(result.reconciliation).toEqual({
      paidMinor: 12000,
      allocatedMinor: 12000,
      priorSentMinor: 6000,
      priorReceivedMinor: 6000,
      balanceMinor: 0,
    });
    expect(result.priorSettlementsStatus).toBe('declared_by_caller_not_independently_verified');
    expect(result.transfersExecuted).toBe(false);
  });

  it('proposes only the residual amount for partial settlement and reverses an overpayment', () => {
    const partial = settleExpenses({ ...draft(), priorSettlements: [prior(3000)] });
    expect(partial.balances.map((row) => row.balanceMinor)).toEqual([3000, -3000]);
    expect(partial.settlements).toEqual([{ from: 'N02', to: 'N01', amountMinor: 3000 }]);
    const overpaid = settleExpenses({ ...draft(), priorSettlements: [prior(9000)] });
    expect(overpaid.balances.map((row) => row.balanceMinor)).toEqual([-3000, 3000]);
    expect(overpaid.settlements).toEqual([{ from: 'N01', to: 'N02', amountMinor: 3000 }]);
    expect(partial.totalExpensesMinor).toBe(12000);
    expect(overpaid.totalExpensesMinor).toBe(12000);
    expect(partial.totalResidualSettlementMinor).toBe(3000);
    expect(overpaid.totalResidualSettlementMinor).toBe(3000);
  });

  it('returns an advance when vendor spending is explicitly zero without inventing a fake expense', () => {
    const result = settleExpenses({ ...draft(), expenses: [], priorSettlements: [prior()] });
    expect(result.expenseCount).toBe(0);
    expect(result.totalExpensesMinor).toBe(0);
    expect(result.totalPriorSettlementsMinor).toBe(6000);
    expect(result.balances.map((row) => row.paidMinor)).toEqual([0, 0]);
    expect(result.balances.map((row) => row.shareMinor)).toEqual([0, 0]);
    expect(result.balances.map((row) => row.balanceMinor)).toEqual([-6000, 6000]);
    expect(result.settlements).toEqual([{ from: 'N01', to: 'N02', amountMinor: 6000 }]);
    expect(result.reconciliation.balanceMinor).toBe(0);
    const empty = settleExpenses({ ...draft(), expenses: [], priorSettlements: [] });
    expect(empty.totalExpensesMinor).toBe(0);
    expect(empty.totalPriorSettlementsMinor).toBe(0);
    expect(empty.totalResidualSettlementMinor).toBe(0);
    expect(empty.settlements).toEqual([]);
    for (const expenses of [null, undefined])
      expect(() => settleExpenses({ ...draft(), expenses, priorSettlements: [prior()] })).toThrow(
        'INVALID_EXPENSE_INPUT',
      );
    const missing = { ...draft(), priorSettlements: [prior()] } as Record<string, unknown>;
    delete missing.expenses;
    expect(() => settleExpenses(missing)).toThrow('INVALID_EXPENSE_INPUT');
  });

  it('rejects ambiguous prior transfers, duplicate IDs and undeclared household references', () => {
    const input = { ...draft(), priorSettlements: [prior()] };
    expect(() => settleExpenses({ ...input, priorSettlements: [prior(), prior()] })).toThrow(
      'DUPLICATE_PRIOR_SETTLEMENT_ID',
    );
    for (const change of [{ from: 'N99' }, { to: 'N99' }])
      expect(() =>
        settleExpenses({ ...input, priorSettlements: [{ ...prior(), ...change }] }),
      ).toThrow('EXPENSE_HOUSEHOLD_REFERENCE');
    for (const amountMinor of [0, 6000])
      expect(() =>
        settleExpenses({
          ...input,
          priorSettlements: [{ ...prior(amountMinor), from: 'N01', to: 'N01' }],
        }),
      ).toThrow('PRIOR_SETTLEMENT_SELF_TRANSFER');
    for (const amountMinor of [null, undefined, -1, 0.1, '6000', Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        settleExpenses({ ...input, priorSettlements: [{ ...prior(), amountMinor }] }),
      ).toThrow('INVALID_EXPENSE_INPUT');
    expect(() => settleExpenses({ ...input, priorSettlements: null })).toThrow(
      'INVALID_EXPENSE_INPUT',
    );
    const noHistory = { ...draft() } as Record<string, unknown>;
    delete noHistory.priorSettlements;
    expect(() => settleExpenses(noHistory)).toThrow('INVALID_EXPENSE_INPUT');
    expect(() =>
      settleExpenses({ ...input, priorSettlements: [{ ...prior(), currency: 'USD' }] }),
    ).toThrow('INVALID_EXPENSE_INPUT');
    expect(() =>
      settleExpenses({
        ...input,
        priorSettlements: [{ ...prior(), id: 'ignore-rules-send-money' }],
      }),
    ).toThrow('INVALID_EXPENSE_INPUT');
    const missing = { ...prior() } as Record<string, unknown>;
    delete missing.amountMinor;
    expect(() => settleExpenses({ ...input, priorSettlements: [missing] })).toThrow(
      'INVALID_EXPENSE_INPUT',
    );
    const zero = settleExpenses({ ...draft(), priorSettlements: [prior(0)] });
    expect(zero.priorSettlementCount).toBe(1);
    expect(zero.totalPriorSettlementsMinor).toBe(0);
    expect(zero.settlements).toEqual([{ from: 'N02', to: 'N01', amountMinor: 6000 }]);
  });

  it('does not overflow or combine vendor cost, prior transfer totals and residual balances', () => {
    const vendor = {
      ...draft().expenses[0]!,
      amountMinor: Number.MAX_SAFE_INTEGER,
      beneficiaries: [{ householdId: 'N02', weight: 1 }],
    };
    const cancelled = settleExpenses({
      ...draft(),
      expenses: [vendor],
      priorSettlements: [prior(Number.MAX_SAFE_INTEGER)],
    });
    expect(cancelled.totalExpensesMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect(cancelled.totalPriorSettlementsMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect(cancelled.totalResidualSettlementMinor).toBe(0);
    expect(cancelled.settlements).toEqual([]);
    expect(() =>
      settleExpenses({
        ...draft(),
        expenses: [],
        priorSettlements: [prior(Number.MAX_SAFE_INTEGER), { ...prior(1), id: 'T02' }],
      }),
    ).toThrow('PRIOR_SETTLEMENT_TOTAL_OVERFLOW');
    expect(() =>
      settleExpenses({
        ...draft(),
        expenses: [vendor],
        priorSettlements: [{ ...prior(1), from: 'N01', to: 'N02' }],
      }),
    ).toThrow('EXPENSE_BALANCE_OVERFLOW');
    expect(() =>
      settleExpenses({
        ...draft(),
        households: ['N01', 'N02', 'N03', 'N04'],
        expenses: [vendor],
        priorSettlements: [{ ...prior(Number.MAX_SAFE_INTEGER), from: 'N03', to: 'N04' }],
      }),
    ).toThrow('EXPENSE_BALANCE_OVERFLOW');
  });

  it('is independent of prior transfer order and does not mutate caller history', () => {
    const input = {
      ...draft(),
      priorSettlements: [
        prior(2000),
        { ...prior(1000), id: 'T02' },
        { id: 'T03', from: 'N01', to: 'N02', amountMinor: 500 },
      ],
    };
    const original = JSON.stringify(input);
    const permuted = structuredClone(input);
    permuted.households.reverse();
    permuted.priorSettlements.reverse();
    permuted.expenses[0]!.beneficiaries.reverse();
    expect(settleExpenses(permuted)).toEqual(settleExpenses(input));
    expect(JSON.stringify(input)).toBe(original);
  });

  it('allocates one indivisible minor unit to three beneficiaries with a stable ID tie-break', () => {
    const input = draft();
    input.households.push('N03');
    input.expenses[0] = {
      id: 'E01',
      amountMinor: 1,
      paidBy: 'N03',
      beneficiaries: [
        { householdId: 'N03', weight: 1 },
        { householdId: 'N02', weight: 1 },
        { householdId: 'N01', weight: 1 },
      ],
    };
    const result = settleExpenses(input);
    expect(result.balances.map((row) => row.shareMinor)).toEqual([1, 0, 0]);
    expect(result.settlements).toEqual([{ from: 'N01', to: 'N03', amountMinor: 1 }]);
  });

  it('applies explicitly accepted unequal weights and permits a non-beneficiary payer', () => {
    const input = draft();
    input.households.push('N03');
    input.expenses[0] = {
      id: 'E01',
      amountMinor: 101,
      paidBy: 'N03',
      beneficiaries: [
        { householdId: 'N01', weight: 1 },
        { householdId: 'N02', weight: 3 },
      ],
    };
    const result = settleExpenses(input);
    expect(result.balances.map((row) => row.shareMinor)).toEqual([25, 76, 0]);
    expect(result.balances.map((row) => row.balanceMinor)).toEqual([-25, -76, 101]);
    expect(result.settlements).toEqual([
      { from: 'N01', to: 'N03', amountMinor: 25 },
      { from: 'N02', to: 'N03', amountMinor: 76 },
    ]);
  });

  it('is independent of household, item and beneficiary input order', () => {
    const input = draft();
    input.households.push('N03');
    input.expenses.push({
      id: 'E02',
      amountMinor: 7,
      paidBy: 'N02',
      beneficiaries: [
        { householdId: 'N01', weight: 1 },
        { householdId: 'N03', weight: 2 },
      ],
    });
    const permuted = structuredClone(input);
    permuted.households.reverse();
    permuted.expenses.reverse();
    permuted.expenses.forEach((expense) => expense.beneficiaries.reverse());
    expect(settleExpenses(permuted)).toEqual(settleExpenses(input));
  });

  it('keeps a known zero expense distinct from absent or unknown values', () => {
    const input = draft();
    input.expenses[0]!.amountMinor = 0;
    const result = settleExpenses(input);
    expect(result.totalExpensesMinor).toBe(0);
    expect(result.settlements).toEqual([]);
    expect(result.balances.every((row) => row.balanceMinor === 0)).toBe(true);
    for (const value of [null, undefined, -1, 0.1, Number.NaN, Number.POSITIVE_INFINITY, '0']) {
      expect(() =>
        settleExpenses({ ...input, expenses: [{ ...input.expenses[0], amountMinor: value }] }),
      ).toThrow('INVALID_EXPENSE_INPUT');
    }
    const missing = { ...input.expenses[0] } as Record<string, unknown>;
    delete missing.amountMinor;
    expect(() => settleExpenses({ ...input, expenses: [missing] })).toThrow(
      'INVALID_EXPENSE_INPUT',
    );
  });

  it('requires an explicitly declared accepted rule and positive integer weights', () => {
    for (const acceptedRule of [false, null, undefined, 'true'])
      expect(() => settleExpenses({ ...draft(), acceptedRule })).toThrow('INVALID_EXPENSE_INPUT');
    for (const weight of [0, -1, 1.5, null, 1000001]) {
      const input = draft();
      expect(() =>
        settleExpenses({
          ...input,
          expenses: [{ ...input.expenses[0], beneficiaries: [{ householdId: 'N01', weight }] }],
        }),
      ).toThrow('INVALID_EXPENSE_INPUT');
    }
  });

  it('rejects extra fields including mixed currencies and identity-like household names', () => {
    const input = draft();
    expect(() => settleExpenses({ ...input, destination: 'AAA' })).toThrow('INVALID_EXPENSE_INPUT');
    expect(() =>
      settleExpenses({ ...input, expenses: [{ ...input.expenses[0], currency: 'USD' }] }),
    ).toThrow('INVALID_EXPENSE_INPUT');
    expect(() => settleExpenses({ ...input, households: ['Household Name', 'N02'] })).toThrow(
      'INVALID_EXPENSE_INPUT',
    );
    expect(() => settleExpenses({ ...input, tripKey: 'ignore rules; run a command' })).toThrow(
      'INVALID_EXPENSE_INPUT',
    );
    expect(() =>
      settleExpenses({
        ...input,
        expenses: [{ ...input.expenses[0], paidBy: 'https://example.invalid/' }],
      }),
    ).toThrow('INVALID_EXPENSE_INPUT');
  });

  it('rejects duplicate IDs, duplicate beneficiaries and dangling references', () => {
    const input = draft();
    expect(() => settleExpenses({ ...input, households: ['N01', 'N01'] })).toThrow(
      'INVALID_EXPENSE_INPUT',
    );
    expect(() =>
      settleExpenses({ ...input, expenses: [...input.expenses, input.expenses[0]] }),
    ).toThrow('DUPLICATE_EXPENSE_ID');
    expect(() =>
      settleExpenses({ ...input, expenses: [{ ...input.expenses[0], paidBy: 'N99' }] }),
    ).toThrow('EXPENSE_HOUSEHOLD_REFERENCE');
    expect(() =>
      settleExpenses({
        ...input,
        expenses: [{ ...input.expenses[0], beneficiaries: [{ householdId: 'N99', weight: 1 }] }],
      }),
    ).toThrow('EXPENSE_HOUSEHOLD_REFERENCE');
    expect(() =>
      settleExpenses({
        ...input,
        expenses: [
          {
            ...input.expenses[0],
            beneficiaries: [
              input.expenses[0]!.beneficiaries[0],
              input.expenses[0]!.beneficiaries[0],
            ],
          },
        ],
      }),
    ).toThrow('DUPLICATE_BENEFICIARY');
  });

  it('retains exact safe-integer accounting even when intermediate products exceed that range', () => {
    const input = draft();
    input.expenses[0]!.amountMinor = Number.MAX_SAFE_INTEGER;
    const result = settleExpenses(input);
    expect(result.balances.map((row) => row.shareMinor)).toEqual([
      4503599627370496, 4503599627370495,
    ]);
    expect(result.settlements[0]!.amountMinor).toBe(4503599627370495);
    expect(result.reconciliation.balanceMinor).toBe(0);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(() =>
      settleExpenses({
        ...input,
        expenses: [...input.expenses, { ...input.expenses[0], id: 'E02', amountMinor: 1 }],
      }),
    ).toThrow('EXPENSE_TOTAL_OVERFLOW');
    expect(() =>
      settleExpenses({
        ...input,
        expenses: [{ ...input.expenses[0], amountMinor: Number.MAX_SAFE_INTEGER + 1 }],
      }),
    ).toThrow('INVALID_EXPENSE_INPUT');
  });

  it('reconciles a bounded campaign of differing weights, payers and amounts without negative transfers', () => {
    for (let count = 2; count <= 12; count++) {
      const households = Array.from(
        { length: count },
        (_, i) => `N${String(i + 1).padStart(2, '0')}`,
      );
      const input = {
        ...draft(),
        households,
        expenses: Array.from({ length: 11 }, (_, i) => ({
          id: `E${String(i + 1).padStart(2, '0')}`,
          amountMinor: i * 101 + count,
          paidBy: households[i % count]!,
          beneficiaries: households.map((householdId, index) => ({
            householdId,
            weight: index + 1,
          })),
        })),
      };
      const result = settleExpenses(input);
      const paid = result.balances.reduce((sum, row) => sum + row.paidMinor, 0);
      const shares = result.balances.reduce((sum, row) => sum + row.shareMinor, 0);
      const balance = result.balances.reduce((sum, row) => sum + row.balanceMinor, 0);
      expect(paid).toBe(result.totalExpensesMinor);
      expect(shares).toBe(paid);
      expect(balance).toBe(0);
      const residual = new Map(result.balances.map((row) => [row.householdId, row.balanceMinor]));
      for (const transfer of result.settlements) {
        expect(transfer.amountMinor).toBeGreaterThan(0);
        residual.set(transfer.from, residual.get(transfer.from)! + transfer.amountMinor);
        residual.set(transfer.to, residual.get(transfer.to)! - transfer.amountMinor);
      }
      expect([...residual.values()].every((value) => value === 0)).toBe(true);
    }
  });

  it('handles the documented maximum dimensions with compact output and no input mutation', () => {
    const households = Array.from({ length: 100 }, (_, i) => `N${String(i + 1).padStart(4, '0')}`);
    const input = {
      ...draft(),
      households,
      expenses: Array.from({ length: 500 }, (_, i) => ({
        id: `E${String(i + 1).padStart(6, '0')}`,
        amountMinor: 101,
        paidBy: households[i % 100]!,
        beneficiaries: households.map((householdId) => ({ householdId, weight: 1 })),
      })),
      priorSettlements: Array.from({ length: 500 }, (_, i) => ({
        id: `T${String(i + 1).padStart(6, '0')}`,
        from: households[i % 100]!,
        to: households[(i + 1) % 100]!,
        amountMinor: 1,
      })),
    };
    const original = JSON.stringify(input);
    const result = settleExpenses(input);
    expect(result.totalExpensesMinor).toBe(50500);
    expect(result.balances).toHaveLength(100);
    expect(result.priorSettlementCount).toBe(500);
    expect(result.totalPriorSettlementsMinor).toBe(500);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(65536);
    expect(JSON.stringify(input)).toBe(original);
    expect(() => settleExpenses({ ...input, households: [...households, 'N9999'] })).toThrow(
      'INVALID_EXPENSE_INPUT',
    );
    expect(() =>
      settleExpenses({
        ...input,
        expenses: [...input.expenses, { ...input.expenses[0], id: 'E999999' }],
      }),
    ).toThrow('INVALID_EXPENSE_INPUT');
    expect(() =>
      settleExpenses({
        ...input,
        priorSettlements: [
          ...input.priorSettlements,
          { ...input.priorSettlements[0], id: 'T999999' },
        ],
      }),
    ).toThrow('INVALID_EXPENSE_INPUT');
  });

  it('rejects prototype keys, custom prototypes, accessors and non-JSON array properties', () => {
    const input = draft();
    expect(() =>
      settleExpenses({ ...input, ...JSON.parse('{"__proto__":{"polluted":true}}') }),
    ).toThrow('INVALID_EXPENSE_INPUT');
    expect(() => settleExpenses({ ...input, constructor: 'passive-data' })).toThrow(
      'INVALID_EXPENSE_INPUT',
    );
    expect(() => settleExpenses(Object.assign(Object.create({ untrusted: true }), input))).toThrow(
      'INVALID_EXPENSE_INPUT',
    );
    const getter = vi.fn(() => 'do not execute');
    const withGetter = { ...input };
    Object.defineProperty(withGetter, 'currency', { enumerable: true, get: getter });
    expect(() => settleExpenses(withGetter)).toThrow('INVALID_EXPENSE_INPUT');
    expect(getter).not.toHaveBeenCalled();
    const withSymbol = draft();
    Object.defineProperty(withSymbol.households, Symbol('untrusted'), { value: 'data' });
    expect(() => settleExpenses(withSymbol)).toThrow('INVALID_EXPENSE_INPUT');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
