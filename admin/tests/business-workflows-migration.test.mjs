import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const FOUNDATION = fileURLToPath(new URL("../../supabase/migrations/001_admin_foundation.sql", import.meta.url));
const PLANS = fileURLToPath(new URL("../../supabase/migrations/004_plans_cms.sql", import.meta.url));
const BUSINESS = fileURLToPath(new URL("../../supabase/migrations/011_business_workflows.sql", import.meta.url));

let db;
let sequence = 0;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
  await db.exec(readFileSync(FOUNDATION, "utf8"));
  await db.exec(readFileSync(PLANS, "utf8"));
  await db.exec(readFileSync(BUSINESS, "utf8"));
});

after(async () => {
  await db?.close();
});

async function seedAcceptedProposal() {
  sequence += 1;
  const { rows: clients } = await db.query(`
    insert into public.clients (name, company, status)
    values ('Aurora Labs', 'Aurora Labs Ltda', 'ACTIVE')
    returning id
  `);
  const { rows: plans } = await db.query(
    `
      insert into public.plans (slug, name, status)
      values ($1, 'Business System', 'AVAILABLE')
      returning id
    `,
    [`business-system-${sequence}`],
  );
  const { rows: proposals } = await db.query(
    `
      insert into public.commercial_proposals (
        proposal_number,
        client_id,
        plan_id,
        title,
        status,
        amount,
        project_category
      )
      values ($3, $1, $2, 'Aurora Operations Portal', 'ACCEPTED', 12000, 'System')
      returning id
    `,
    [clients[0].id, plans[0].id, `PROP-011-${sequence}`],
  );

  return { clientId: clients[0].id, planId: plans[0].id, proposalId: proposals[0].id };
}

describe("business workflows migration", () => {
  it("is idempotent", async () => {
    await db.exec(readFileSync(BUSINESS, "utf8"));
  });

  it("stores the minimum real proposal relationships", async () => {
    const seeded = await seedAcceptedProposal();

    assert.ok(seeded.clientId);
    assert.ok(seeded.planId);
    assert.ok(seeded.proposalId);
  });

  it("enforces known proposal and project categories", async () => {
    const { rows: clients } = await db.query(
      "insert into public.clients (name) values ('Category Test') returning id",
    );
    const { rows: plans } = await db.query(
      "insert into public.plans (slug, name) values ('category-test', 'Category Test') returning id",
    );

    await assert.rejects(() =>
      db.query(
        `
          insert into public.commercial_proposals (
            proposal_number,
            client_id,
            plan_id,
            title,
            status,
            project_category
          )
          values ('PROP-BAD-CAT', $1, $2, 'Bad Category', 'ACCEPTED', 'Consulting')
        `,
        [clients[0].id, plans[0].id],
      ),
    );
  });

  it("allows exactly one project handoff per proposal", async () => {
    const { proposalId } = await seedAcceptedProposal();
    const { rows: projects } = await db.query(`
      insert into public.projects (case_number, name, slug, category, status, editorial_status, visible)
      values (991, 'Aurora Operations Portal', 'aurora-operations-portal', 'System', 'In Development', 'DRAFT', false)
      returning id
    `);

    await db.query(
      `
        insert into public.commercial_project_handoffs (proposal_id, project_id)
        values ($1, $2)
      `,
      [proposalId, projects[0].id],
    );

    await assert.rejects(() =>
      db.query(
        `
          insert into public.commercial_project_handoffs (proposal_id, project_id)
          values ($1, $2)
        `,
        [proposalId, projects[0].id],
      ),
    );
  });

  it("keeps business tables private to anonymous clients", async () => {
    const { rows: grants } = await db.query(`
      select grantee, table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('clients', 'commercial_proposals', 'commercial_project_handoffs')
        and grantee = 'anon'
    `);

    assert.deepEqual(grants, []);

    const { rows: enabled } = await db.query(`
      select relname, relrowsecurity
      from pg_class
      where relname in ('clients', 'commercial_proposals', 'commercial_project_handoffs')
      order by relname
    `);

    assert.deepEqual(
      enabled.map((row) => [row.relname, row.relrowsecurity]),
      [
        ["clients", true],
        ["commercial_project_handoffs", true],
        ["commercial_proposals", true],
      ],
    );
  });
});
