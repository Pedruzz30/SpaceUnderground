// Seed for the mock financial repository only. Supabase mode never reads this:
// real entries live in public.financial_transactions. Dates are relative to
// today so the ledger, the overdue flag and the monthly report always have
// something current to show. Client and project ids point at the mock seeds in
// data/clients.js and data/projects.js.

import { toDateKey } from "../utils/financial-metrics.js";

function daysFromToday(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function entry(id, values) {
  const dueDate = daysFromToday(values.due);
  const status = values.status ?? "PAID";
  return {
    id,
    type: values.type,
    status,
    description: values.description,
    category: values.category,
    amount: values.amount,
    currency: "BRL",
    dueDate,
    paidAt: status === "PAID" ? dueDate : null,
    clientId: values.clientId ?? null,
    projectId: values.projectId ?? null,
    notes: values.notes ?? "",
    createdAt: new Date(`${dueDate}T12:00:00`).toISOString(),
    updatedAt: new Date(`${dueDate}T12:00:00`).toISOString(),
  };
}

export function buildSeedTransactions() {
  return [
    entry("mock-tx-001", { type: "INCOME", description: "Lucas Souza / 2ª parcela", category: "PROJECT", amount: 1750, due: -1, clientId: "mock-client-002", projectId: "002" }),
    entry("mock-tx-002", { type: "EXPENSE", description: "Infraestrutura", category: "INFRASTRUCTURE", amount: 90, due: -2 }),
    entry("mock-tx-003", { type: "INCOME", status: "PENDING", description: "Luciano Pimenta / parcela do projeto", category: "PROJECT", amount: 1000, due: -3, notes: "Cobrar por mensagem." }),
    entry("mock-tx-004", { type: "INCOME", description: "Luciano Pimenta / 1ª parcela", category: "PROJECT", amount: 3200, due: -6 }),
    entry("mock-tx-005", { type: "EXPENSE", description: "Ferramentas de design", category: "SOFTWARE", amount: 160, due: -8 }),
    entry("mock-tx-006", { type: "INCOME", status: "PENDING", description: "Lucas Souza / 3ª parcela", category: "PROJECT", amount: 1750, due: 20, clientId: "mock-client-002", projectId: "002" }),
    entry("mock-tx-007", { type: "INCOME", description: "Empresa Y / pagamento final", category: "PROJECT", amount: 3450, due: -14, clientId: "mock-client-004" }),
    entry("mock-tx-008", { type: "EXPENSE", description: "Storage e domínios", category: "INFRASTRUCTURE", amount: 1000, due: -18 }),
    entry("mock-tx-009", { type: "EXPENSE", status: "PENDING", description: "Freelancer de ilustração", category: "FREELANCER", amount: 450, due: 7 }),
    entry("mock-tx-010", { type: "INCOME", description: "INK Tattoo / manutenção mensal", category: "RETAINER", amount: 2400, due: -35, clientId: "mock-client-001", projectId: "001" }),
    entry("mock-tx-011", { type: "EXPENSE", description: "Impostos (DAS)", category: "TAXES", amount: 320, due: -40 }),
    entry("mock-tx-012", { type: "INCOME", description: "Empresa Y / entrada", category: "PROJECT", amount: 5200, due: -65, clientId: "mock-client-004" }),
    entry("mock-tx-013", { type: "EXPENSE", description: "Campanha de anúncios", category: "MARKETING", amount: 780, due: -70 }),
    entry("mock-tx-014", { type: "INCOME", description: "INK Tattoo / manutenção mensal", category: "RETAINER", amount: 2400, due: -95, clientId: "mock-client-001", projectId: "001" }),
    entry("mock-tx-015", { type: "EXPENSE", description: "Infraestrutura", category: "INFRASTRUCTURE", amount: 90, due: -100 }),
    entry("mock-tx-016", { type: "INCOME", description: "Consultoria de automação", category: "CONSULTING", amount: 1800, due: -125, clientId: "mock-client-003" }),
    entry("mock-tx-017", { type: "INCOME", status: "CANCELLED", description: "Orçamento recusado", category: "PROJECT", amount: 900, due: -30, clientId: "mock-client-003" }),
  ];
}
