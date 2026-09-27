// PRESENTATION-ONLY DATA — Operations UI (Phase C).
//
// Commercial and Financial have no backend yet. This module exists so those
// screens can be designed and reviewed with realistic content, and it is
// deliberately kept OUT of src/services: no repository, service or Supabase
// query reads from here, and nothing here is ever written anywhere. When the
// real tables land, these exports are replaced by services and this file goes.
//
// Clients moved to the real data layer in Clients V2 (client-service.js). The
// `client` names below are free text on purpose: they are not linked to client
// records, and Commercial V2 / Financial V2 are where that relationship lands.

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(Date.now() - days * DAY).toISOString();
}

export const demoPipelineStages = [
  { id: "NEW", label: "NEW" },
  { id: "CONTACTED", label: "CONTACTED" },
  { id: "PROPOSAL", label: "PROPOSAL" },
  { id: "NEGOTIATION", label: "NEGOTIATION" },
  { id: "WON", label: "WON" },
];

export const demoOpportunities = [
  {
    id: "opp-001",
    stage: "NEW",
    client: "ACADEMIA X",
    company: "Academia X",
    type: "System Web",
    range: "R$ 8.000 – R$ 12.000",
    activity: "Received 2h ago",
    priority: "HIGH",
  },
  {
    id: "opp-002",
    stage: "NEW",
    client: "ESTÚDIO NORTE",
    company: "Estúdio Norte",
    type: "Institutional Website",
    range: "From R$ 3.500",
    activity: "Received yesterday",
    priority: "LOW",
  },
  {
    id: "opp-003",
    stage: "CONTACTED",
    client: "EMPRESA Y",
    company: "Empresa Y Logística",
    type: "Automation",
    range: "From R$ 5.000",
    activity: "Contacted yesterday",
    priority: "MEDIUM",
  },
  {
    id: "opp-004",
    stage: "PROPOSAL",
    client: "PROJETO Z",
    company: "Projeto Z Cultural",
    type: "Institutional Website",
    range: "R$ 4.500",
    activity: "Proposal sent 3d ago",
    priority: "MEDIUM",
  },
  {
    id: "opp-005",
    stage: "PROPOSAL",
    client: "CLÍNICA VETOR",
    company: "Clínica Vetor",
    type: "Landing page",
    range: "R$ 2.400",
    activity: "Proposal sent 5d ago",
    priority: "LOW",
  },
  {
    id: "opp-006",
    stage: "NEGOTIATION",
    client: "LUCIANO PIMENTA",
    company: "Pimenta Studio",
    type: "Maintenance retainer",
    range: "R$ 900 / month",
    activity: "Reviewing scope",
    priority: "HIGH",
  },
  {
    id: "opp-007",
    stage: "WON",
    client: "LUCAS SOUZA",
    company: "Souza Performance",
    type: "System Web",
    range: "R$ 3.500",
    activity: "Closed 6d ago",
    priority: "MEDIUM",
  },
];

export const demoTransactions = [
  {
    id: "tx-001",
    date: daysAgo(1),
    type: "INCOME",
    description: "Lucas Souza / 2nd installment",
    client: "Lucas Souza",
    status: "PAID",
    amount: 1750,
  },
  {
    id: "tx-002",
    date: daysAgo(2),
    type: "EXPENSE",
    description: "Infrastructure",
    client: null,
    status: "PAID",
    amount: -90,
  },
  {
    id: "tx-003",
    date: daysAgo(3),
    type: "RECEIVABLE",
    description: "Project installment",
    client: "Luciano Pimenta",
    status: "PENDING",
    amount: 1000,
  },
  {
    id: "tx-004",
    date: daysAgo(6),
    type: "INCOME",
    description: "Luciano Pimenta / 1st installment",
    client: "Luciano Pimenta",
    status: "PAID",
    amount: 3200,
  },
  {
    id: "tx-005",
    date: daysAgo(8),
    type: "EXPENSE",
    description: "Design tooling",
    client: null,
    status: "PAID",
    amount: -160,
  },
  {
    id: "tx-006",
    date: daysAgo(11),
    type: "RECEIVABLE",
    description: "Lucas Souza / 3rd installment",
    client: "Lucas Souza",
    status: "PENDING",
    amount: 1750,
  },
  {
    id: "tx-007",
    date: daysAgo(14),
    type: "INCOME",
    description: "Empresa Y / final payment",
    client: "Empresa Y",
    status: "PAID",
    amount: 3450,
  },
  {
    id: "tx-008",
    date: daysAgo(18),
    type: "EXPENSE",
    description: "Storage and domains",
    client: null,
    status: "PAID",
    amount: -1000,
  },
];
