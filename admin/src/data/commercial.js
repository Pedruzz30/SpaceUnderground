// Seed for the mock commercial repository only. Supabase mode never reads this:
// real deals live in public.commercial_opportunities. Dates are relative to
// today so the board always has current, stale and overdue deals to show.
// Client and plan ids point at the mock seeds in data/clients.js and
// data/plans.js; leads without a client carry their own contact.

import { toDateKey } from "../utils/financial-metrics.js";

const DAY = 24 * 60 * 60 * 1000;

const isoDaysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();
const dayFromToday = (days) => toDateKey(new Date(Date.now() + days * DAY));

function deal(id, values) {
  const closed = values.stage === "WON" || values.stage === "LOST";
  const stageDays = values.stageDays ?? 1;
  return {
    id,
    title: values.title,
    stage: values.stage,
    priority: values.priority ?? "MEDIUM",
    source: values.source ?? "OTHER",
    clientId: values.clientId ?? null,
    planId: values.planId ?? null,
    contactName: values.contactName ?? "",
    company: values.company ?? "",
    email: values.email ?? "",
    phone: values.phone ?? "",
    estimatedValue: values.value ?? null,
    expectedCloseDate: values.close === undefined ? null : dayFromToday(values.close),
    nextAction: values.nextAction ?? "",
    nextActionAt: values.nextActionIn === undefined ? null : dayFromToday(values.nextActionIn),
    lastContactAt: values.lastContactDays === undefined ? null : dayFromToday(-values.lastContactDays),
    lostReason: values.lostReason ?? null,
    position: values.position ?? 0,
    notes: values.notes ?? "",
    stageChangedAt: isoDaysAgo(stageDays),
    closedAt: closed ? isoDaysAgo(stageDays) : null,
    createdAt: isoDaysAgo(values.createdDays ?? stageDays + 3),
    updatedAt: isoDaysAgo(stageDays),
  };
}

export function buildSeedOpportunities() {
  return [
    deal("mock-opp-001", { title: "Sistema web de agendamento", stage: "NEW", priority: "HIGH", source: "INSTAGRAM", clientId: "mock-client-003", planId: "mock-plan-max", value: 10000, nextAction: "Ligar para entender o escopo", nextActionIn: 1, stageDays: 0, position: 0 }),
    deal("mock-opp-002", { title: "Site institucional", stage: "NEW", priority: "LOW", source: "WEBSITE", contactName: "Marina Costa", company: "Estúdio Norte", email: "marina@estudionorte.example.com", planId: "mock-plan-pro", value: 3500, stageDays: 1, position: 1 }),
    deal("mock-opp-003", { title: "Automação de pedidos", stage: "CONTACTED", priority: "MEDIUM", source: "REFERRAL", clientId: "mock-client-004", value: 5000, nextAction: "Enviar diagnóstico", nextActionIn: -2, stageDays: 4, lastContactDays: 4, position: 0 }),
    deal("mock-opp-004", { title: "Site institucional cultural", stage: "PROPOSAL", priority: "MEDIUM", source: "REFERRAL", contactName: "Rafael Lima", company: "Projeto Z Cultural", planId: "mock-plan-pro", value: 4500, nextAction: "Cobrar retorno da proposta", nextActionIn: 2, stageDays: 3, lastContactDays: 3, close: 10, position: 0 }),
    deal("mock-opp-005", { title: "Landing page de campanha", stage: "PROPOSAL", priority: "LOW", source: "WHATSAPP", contactName: "Dra. Paula", company: "Clínica Vetor", planId: "mock-plan-plus", value: 2400, stageDays: 16, lastContactDays: 16, position: 1 }),
    deal("mock-opp-006", { title: "Manutenção mensal", stage: "NEGOTIATION", priority: "HIGH", source: "REFERRAL", contactName: "Luciano Pimenta", company: "Pimenta Studio", value: 10800, nextAction: "Fechar escopo do contrato anual", nextActionIn: 0, stageDays: 5, close: 7, notes: "R$ 900 por mês, contrato de 12 meses.", position: 0 }),
    deal("mock-opp-007", { title: "Sistema web de treinos", stage: "WON", priority: "MEDIUM", source: "INSTAGRAM", clientId: "mock-client-002", planId: "mock-plan-max", value: 3500, stageDays: 6, createdDays: 30, position: 0 }),
    deal("mock-opp-008", { title: "Portfólio com loja", stage: "LOST", priority: "MEDIUM", source: "WEBSITE", contactName: "Bruno Alves", company: "Alves Fotografia", value: 6000, lostReason: "PRICE", stageDays: 20, createdDays: 45, position: 0 }),
    deal("mock-opp-009", { title: "Manutenção do portfólio", stage: "WON", priority: "LOW", source: "REFERRAL", clientId: "mock-client-001", planId: "mock-plan-plus", value: 2400, stageDays: 40, createdDays: 55, position: 1 }),
    deal("mock-opp-010", { title: "App de delivery", stage: "LOST", priority: "HIGH", source: "EVENT", contactName: "Camila Rocha", company: "Rocha Burgers", value: 15000, lostReason: "TIMING", stageDays: 50, createdDays: 70, position: 1 }),
  ];
}
