export const SERVICE_STATUSES = ["AVAILABLE", "LIMITED", "ON_REQUEST", "WAITLIST", "UNAVAILABLE", "ARCHIVED"];

const STATUS_ALIASES = new Map([
  ["AVAILABLE", "AVAILABLE"],
  ["DISPONÍVEL", "AVAILABLE"],
  ["DISPONIVEL", "AVAILABLE"],
  ["LIMITED", "LIMITED"],
  ["LIMITADO", "LIMITED"],
  ["ON_REQUEST", "ON_REQUEST"],
  ["ON REQUEST", "ON_REQUEST"],
  ["SOB CONSULTA", "ON_REQUEST"],
  ["WAITLIST", "WAITLIST"],
  ["LISTA DE ESPERA", "WAITLIST"],
  ["UNAVAILABLE", "UNAVAILABLE"],
  ["INDISPONÍVEL", "UNAVAILABLE"],
  ["INDISPONIVEL", "UNAVAILABLE"],
  ["ARCHIVED", "ARCHIVED"],
  ["ARQUIVADO", "ARCHIVED"],
]);

const STATUS_LABELS = {
  "pt-BR": {
    AVAILABLE: "DISPONÍVEL",
    LIMITED: "LIMITADO",
    ON_REQUEST: "SOB CONSULTA",
    WAITLIST: "LISTA DE ESPERA",
    UNAVAILABLE: "INDISPONÍVEL",
    ARCHIVED: "ARQUIVADO",
  },
  en: {
    AVAILABLE: "AVAILABLE",
    LIMITED: "LIMITED",
    ON_REQUEST: "ON REQUEST",
    WAITLIST: "WAITLIST",
    UNAVAILABLE: "UNAVAILABLE",
    ARCHIVED: "ARCHIVED",
  },
};

export function normalizeServiceStatus(value) {
  const key = String(value || "").trim().toUpperCase();
  return STATUS_ALIASES.get(key) || key;
}

export function serviceStatusLabel(value, locale = "pt-BR") {
  const status = normalizeServiceStatus(value);
  return STATUS_LABELS[locale]?.[status] ?? STATUS_LABELS["pt-BR"][status] ?? String(value || "");
}
