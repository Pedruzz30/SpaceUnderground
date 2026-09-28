import { DATA_SOURCE } from "../config/env.js";
import { resetMockActivity } from "./repositories/mock-activity-repository.js";
import { resetMockClients } from "./repositories/mock-client-repository.js";
import { resetMockCommercial } from "./repositories/mock-commercial-repository.js";
import { resetMockFinancial } from "./repositories/mock-financial-repository.js";
import { resetMockPlans } from "./repositories/mock-plan-repository.js";
import { resetMockProjects } from "./repositories/mock-project-repository.js";

// Restores the seed data from data/projects.js. Development helper only:
// run `window.__resetSpaceAdminMocks()` in the browser console.
export function resetMockData() {
  resetMockProjects();
  resetMockPlans();
  resetMockClients();
  resetMockFinancial();
  resetMockCommercial();
  resetMockActivity();
}

if (typeof window !== "undefined") {
  window.__resetSpaceAdminMocks = resetMockData;
  // Lets a test refuse to run destructive mock steps against a real backend.
  // The data source is not a secret; the credentials behind it never surface.
  window.__spaceAdminDataSource = DATA_SOURCE;
}
