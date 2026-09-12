// Static project configuration, not a health probe: nothing here contacts the
// public website, so the wording never claims it is up. Copy lives in the
// dictionaries; this module only names which entries to show.
export const spaceStatus = {
  labelKey: "dashboard.acceptingProjects",
  detailKey: "dashboard.publicWebsiteConfigured",
};
