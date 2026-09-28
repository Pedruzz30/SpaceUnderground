// Figures derived from real client and project records. Nothing here is
// stored: a client never keeps a count or a total of its own.

// A project is "active" while it is still being delivered. Live means shipped,
// Archived means closed, and an editorially archived case is out of play too.
const CLOSED_PROJECT_STATUSES = new Set(["Live", "Archived"]);

export function isActiveProject(project = {}) {
  return project.editorialStatus !== "ARCHIVED" && !CLOSED_PROJECT_STATUSES.has(project.status);
}

export function isDeliveredProject(project = {}) {
  return project.editorialStatus !== "ARCHIVED" && project.status === "Live";
}

export function groupProjectsByClient(projects = []) {
  const groups = new Map();
  projects.forEach((project) => {
    if (!project.clientId) return;
    if (!groups.has(project.clientId)) groups.set(project.clientId, []);
    groups.get(project.clientId).push(project);
  });
  return groups;
}

export function projectSummary(projects = []) {
  return {
    total: projects.length,
    active: projects.filter(isActiveProject).length,
    delivered: projects.filter(isDeliveredProject).length,
  };
}

export function clientMetrics(clients = [], projectsByClient = new Map()) {
  const count = (status) => clients.filter((client) => client.status === status).length;
  return {
    total: clients.length,
    active: count("ACTIVE"),
    leads: count("LEAD"),
    withActiveProjects: clients.filter((client) => (projectsByClient.get(client.id) ?? []).some(isActiveProject)).length,
    inactiveOrArchived: count("INACTIVE") + count("ARCHIVED"),
  };
}

// Search matches the fields a person would type from memory.
export function matchesClientQuery(client, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  return [client.name, client.company, client.email, client.phone, client.code].some((value) =>
    String(value ?? "").toLowerCase().includes(needle),
  );
}
