import { resetMockActivity } from "./repositories/mock-activity-repository.js";
import { resetMockProjects } from "./repositories/mock-project-repository.js";

// Restores the seed data from data/projects.js. Development helper only:
// run `window.__resetSpaceAdminMocks()` in the browser console.
export function resetMockData() {
  resetMockProjects();
  resetMockActivity();
}

if (typeof window !== "undefined") {
  window.__resetSpaceAdminMocks = resetMockData;
}
