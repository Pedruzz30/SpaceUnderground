// Ledger rules for the presentation-only financial data.
//
// demoTransactions is the single source of truth: every figure any screen shows
// is derived from the entries, never from a standing summary that could drift
// away from them. Pure functions, no period concept — the Dashboard layers its
// period window on top of these in dashboard-metrics.js.

function sumOf(transactions, type, status) {
  return transactions
    .filter((transaction) => transaction.type === type && transaction.status === status)
    .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
}

// Money that is still owed. Pending until it is paid, and never revenue.
export function pendingReceivables(transactions = []) {
  return sumOf(transactions, "RECEIVABLE", "PENDING");
}

// Only settled money counts toward revenue and expenses.
export function financialSummary(transactions = []) {
  const revenue = sumOf(transactions, "INCOME", "PAID");
  const expenses = sumOf(transactions, "EXPENSE", "PAID");

  return {
    revenue,
    expenses,
    result: revenue - expenses,
    toReceive: pendingReceivables(transactions),
  };
}
