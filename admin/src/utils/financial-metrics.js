// Ledger rules for the presentation-only financial data.
//
// demoTransactions is the single source of truth: every figure any screen shows
// is derived from the entries, never from a standing summary that could drift
// away from them. Pure functions, no period concept — the Dashboard layers its
// period window on top of these in dashboard-metrics.js.

function sumTransactions(transactions) {
  return transactions.reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
}

// Only settled money counts toward revenue.
export function settledIncome(transactions = []) {
  return transactions.filter((transaction) => transaction.type === "INCOME" && transaction.status === "PAID");
}

// Only settled money counts toward expenses.
export function settledExpenses(transactions = []) {
  return transactions.filter((transaction) => transaction.type === "EXPENSE" && transaction.status === "PAID");
}

// Money that is still owed. Pending until it is paid, and never revenue.
export function openReceivables(transactions = []) {
  return transactions.filter((transaction) => transaction.type === "RECEIVABLE" && transaction.status === "PENDING");
}

// Money that is still owed. Pending until it is paid, and never revenue.
export function pendingReceivables(transactions = []) {
  return sumTransactions(openReceivables(transactions));
}

// Only settled money counts toward revenue and expenses.
export function financialSummary(transactions = []) {
  const revenue = sumTransactions(settledIncome(transactions));
  const expenses = sumTransactions(settledExpenses(transactions));

  return {
    revenue,
    expenses,
    result: revenue - expenses,
    toReceive: pendingReceivables(transactions),
  };
}
