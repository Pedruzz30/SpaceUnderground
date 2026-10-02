// Mock mode only: the people the local Admin can sign in as, one per role, so
// every permission-shaped screen can be tried without Supabase. Supabase mode
// never reads this file; its team lives in public.team_members.

export const MOCK_PROFILES = ["owner", "seo", "manager", "collaborator", "viewer", "absolute"];

export const MOCK_MEMBER_SEED = [
  { profile: "owner", ru: "SU-00001", displayName: "Owner", roles: ["OWNER"], mfa: true },
  { profile: "seo", ru: "SU-00002", displayName: "SEO", roles: ["SEO", "OWNER"], mfa: true },
  { profile: "manager", ru: "SU-00003", displayName: "Manager", roles: ["MANAGER"], mfa: true },
  {
    profile: "collaborator",
    ru: "SU-00004",
    displayName: "Collaborator",
    roles: ["COLLABORATOR"],
    projects: [
      { projectId: "001", accessLevel: "EDIT" },
      { projectId: "002", accessLevel: "VIEW" },
    ],
  },
  { profile: "viewer", ru: "SU-00005", displayName: "Viewer", roles: ["VIEWER"], projects: [{ projectId: "001", accessLevel: "VIEW" }] },
  { profile: "absolute", ru: "SU-00006", displayName: "Break-glass", roles: ["ABSOLUTE_ADMIN"], mfa: true },
  { profile: null, ru: "SU-00007", displayName: "Invited", roles: ["COLLABORATOR"], status: "INVITED", projects: [{ projectId: "002", accessLevel: "EDIT" }] },
  { profile: null, ru: "SU-00008", displayName: "Suspended", roles: ["COLLABORATOR"], status: "SUSPENDED", statusReason: "Contract paused" },
  { profile: null, ru: "SU-00009", displayName: "Former", roles: [], status: "OFFBOARDED", statusReason: "Left the studio" },
];

export const mockUserId = (seed) => `mock-${seed.profile ?? seed.ru.toLowerCase()}`;
export const mockEmail = (seed) => `${seed.profile ?? seed.ru.toLowerCase()}@spaceunderground.local`;
