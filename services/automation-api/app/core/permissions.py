"""Which permission each automation capability needs.

There is no automation permission in the RBAC catalog, and none is invented
here: every capability maps onto the permission that already governs the same
business effect in the Admin. Reading run history is reading a log; analysing
a project is reading it; a workflow that opens a project needs the permission
to create one. A member therefore can never do through this service what the
Admin -- and row level security -- would refuse them.

The keys are the ones seeded by the security foundation migration (and listed
in admin/src/security/catalog.js).
"""

from __future__ import annotations

LOGS_READ = "logs.read"
PROJECTS_READ = "projects.read"
PROJECTS_CREATE = "projects.create"
PROJECTS_EDIT = "projects.edit"
PROJECTS_PUBLISH = "projects.publish"
COMMERCIAL_READ = "commercial.read"
COMMERCIAL_EDIT = "commercial.edit"
FINANCE_READ = "finance.read"
FINANCE_EDIT = "finance.edit"
SETTINGS_EDIT = "settings.edit"

# Run history, its statistics and the list of registered automations.
VIEW_RUNS = (LOGS_READ,)

# Operational analysis and the catalogue overview read projects.
ANALYZE_PROJECTS = (PROJECTS_READ,)

# Starting a scheduled job by hand. Jobs only detect and record, but they read
# every module, so they belong to whoever administers the system.
RUN_JOBS = (SETTINGS_EDIT,)

# What /auth/me reports, so the Admin can show or hide controls without
# guessing. Display only: every endpoint checks again on its own.
REPORTED = (
    LOGS_READ,
    PROJECTS_READ,
    PROJECTS_CREATE,
    PROJECTS_EDIT,
    PROJECTS_PUBLISH,
    COMMERCIAL_READ,
    COMMERCIAL_EDIT,
    FINANCE_READ,
    FINANCE_EDIT,
    SETTINGS_EDIT,
)
