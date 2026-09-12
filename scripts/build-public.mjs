// Ensures the public GitHub Pages build always has the public Supabase config.
// These values are intentionally publishable: browser clients receive them,
// while Row Level Security remains the actual data-access boundary.

process.env.VITE_SUPABASE_URL ||= "https://zvzfkfvxbuofgqrrogxh.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY ||= "sb_publishable_9Qbcn3bpKZuogZRjDpz76Q_aX0tttRH";

const { build } = await import("vite");
await build();
