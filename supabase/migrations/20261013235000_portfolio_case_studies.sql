-- Space Underground — portfolio case studies (Phase 2)
--
-- Adds a small, explicit case-study model to public.projects so the portfolio
-- can distinguish client work, products and lab experiments without inferring
-- that from client names or project status. The narrative fields are editorial
-- copy and therefore participate in the existing translations jsonb contract.
--
-- Existing public cases are backfilled conservatively from information already
-- represented in the repository. Results describe demonstrated capability; no
-- unverified business metric is introduced.

alter table public.projects
  add column if not exists case_kind text not null default 'Product'
    check (case_kind in ('Client', 'Product', 'Lab')),
  add column if not exists case_context text,
  add column if not exists case_problem text,
  add column if not exists case_solution text,
  add column if not exists case_result text;

comment on column public.projects.case_kind is
  'Public case classification: Client, Product or Lab. It describes the nature of the case, not project status.';
comment on column public.projects.case_context is
  'Editorial context for the public case study.';
comment on column public.projects.case_problem is
  'Problem or operational need addressed by the project.';
comment on column public.projects.case_solution is
  'How the project approaches the problem.';
comment on column public.projects.case_result is
  'Verified result or demonstrated capability. Do not store unsupported metrics.';

-- CASE 001 — client website.
update public.projects
set
  case_kind = 'Client',
  case_context = case when nullif(btrim(case_context), '') is null
    then 'Presença digital para um estúdio de tatuagem com linguagem visual forte e portfólio como elemento central.'
    else case_context end,
  case_problem = case when nullif(btrim(case_problem), '') is null
    then 'Apresentar identidade, trabalhos e atmosfera da marca sem depender de uma interface genérica.'
    else case_problem end,
  case_solution = case when nullif(btrim(case_solution), '') is null
    then 'Experiência editorial escura com composição visual, movimento e navegação orientada ao portfólio.'
    else case_solution end,
  case_result = case when nullif(btrim(case_result), '') is null
    then 'O case demonstra direção de arte, interação responsiva e construção de presença digital para uma marca visual.'
    else case_result end,
  translations = coalesce(translations, '{}'::jsonb) || jsonb_build_object(
    'en',
    coalesce(translations -> 'en', '{}'::jsonb) || jsonb_build_object(
      'case_context', 'Digital presence for a tattoo studio with a strong visual language and the portfolio at its core.',
      'case_problem', 'Present the brand identity, work and atmosphere without relying on a generic interface.',
      'case_solution', 'A dark editorial experience combining visual composition, motion and portfolio-led navigation.',
      'case_result', 'The case demonstrates art direction, responsive interaction and digital presence work for a visual brand.'
    )
  )
where case_number = 1;

-- CASE 002 — client website.
update public.projects
set
  case_kind = 'Client',
  case_context = case when nullif(btrim(case_context), '') is null
    then 'Presença digital voltada a nutrição esportiva, performance e construção de credibilidade profissional.'
    else case_context end,
  case_problem = case when nullif(btrim(case_problem), '') is null
    then 'Organizar a proposta profissional em uma experiência clara que comunique atuação, confiança e próximos passos.'
    else case_problem end,
  case_solution = case when nullif(btrim(case_solution), '') is null
    then 'Site responsivo com narrativa de performance, hierarquia de conteúdo e pontos de conversão distribuídos pela experiência.'
    else case_solution end,
  case_result = case when nullif(btrim(case_result), '') is null
    then 'O case demonstra estratégia de conteúdo, apresentação de serviço e implementação front-end orientada à conversão.'
    else case_result end,
  translations = coalesce(translations, '{}'::jsonb) || jsonb_build_object(
    'en',
    coalesce(translations -> 'en', '{}'::jsonb) || jsonb_build_object(
      'case_context', 'Digital presence focused on sports nutrition, performance and professional credibility.',
      'case_problem', 'Organize the professional offering into a clear experience that communicates expertise, trust and next steps.',
      'case_solution', 'A responsive website with a performance-led narrative, clear content hierarchy and conversion points throughout the experience.',
      'case_result', 'The case demonstrates content strategy, service presentation and conversion-oriented front-end implementation.'
    )
  )
where case_number = 2;

-- CASE 003 — Space Underground lab.
update public.projects
set
  case_kind = 'Lab',
  case_context = case when nullif(btrim(case_context), '') is null
    then 'Laboratório interno para explorar uma interface de assistência inteligente no Windows.'
    else case_context end,
  case_problem = case when nullif(btrim(case_problem), '') is null
    then 'Combinar conversa, voz, memória, automação e controle do sistema sem remover limites de permissão e segurança.'
    else case_problem end,
  case_solution = case when nullif(btrim(case_solution), '') is null
    then 'Protótipo desktop em Python e PyQt6 com camada de IA, ferramentas de automação, memória e controles de permissão.'
    else case_solution end,
  case_result = case when nullif(btrim(case_result), '') is null
    then 'O protótipo demonstra integração entre IA conversacional, automação local e uma camada explícita de segurança por permissões.'
    else case_result end,
  project_url = case when nullif(btrim(project_url), '') is null then './jarvis-case/' else project_url end,
  preview_url = case when nullif(btrim(preview_url), '') is null then './jarvis-demo/?embed=spaceunderground' else preview_url end,
  live_preview_enabled = true,
  translations = coalesce(translations, '{}'::jsonb) || jsonb_build_object(
    'en',
    coalesce(translations -> 'en', '{}'::jsonb) || jsonb_build_object(
      'case_context', 'Internal lab exploring an intelligent assistant interface for Windows.',
      'case_problem', 'Combine conversation, voice, memory, automation and system control without removing permission and security boundaries.',
      'case_solution', 'A Python and PyQt6 desktop prototype with an AI layer, automation tools, memory and permission controls.',
      'case_result', 'The prototype demonstrates the integration of conversational AI, local automation and an explicit permission-based security layer.'
    )
  )
where case_number = 3;

-- CASE 004 — product / operational system.
update public.projects
set
  case_kind = 'Product',
  case_context = case when nullif(btrim(case_context), '') is null
    then 'Sistema de gestão de estoque escolar para itens de cozinha e limpeza.'
    else case_context end,
  case_problem = case when nullif(btrim(case_problem), '') is null
    then 'Centralizar movimentações, auditoria, alertas e informações de reposição que podem ficar dispersas em controles manuais.'
    else case_problem end,
  case_solution = case when nullif(btrim(case_solution), '') is null
    then 'Fluxo de estoque com entradas e saídas, histórico, alertas, sincronização com planilhas e leitura assistida de notas fiscais.'
    else case_solution end,
  case_result = case when nullif(btrim(case_result), '') is null
    then 'O case demonstra um fluxo operacional completo de estoque e integração entre interface, dados, automação e IA.'
    else case_result end,
  project_url = case when nullif(btrim(project_url), '') is null then './gestao-escolar-demo/' else project_url end,
  preview_url = case when nullif(btrim(preview_url), '') is null then './gestao-escolar-demo/?embed=spaceunderground' else preview_url end,
  live_preview_enabled = true,
  translations = coalesce(translations, '{}'::jsonb) || jsonb_build_object(
    'en',
    coalesce(translations -> 'en', '{}'::jsonb) || jsonb_build_object(
      'case_context', 'School inventory management system for kitchen and cleaning supplies.',
      'case_problem', 'Centralize stock movements, auditing, alerts and replenishment information that can become scattered across manual controls.',
      'case_solution', 'An inventory flow with inbound and outbound movements, history, alerts, spreadsheet syncing and assisted invoice reading.',
      'case_result', 'The case demonstrates an end-to-end inventory workflow integrating interface, data, automation and AI.'
    )
  )
where case_number = 4;

-- CASE 005 — product MVP.
update public.projects
set
  case_kind = 'Product',
  case_context = case when nullif(btrim(case_context), '') is null
    then 'MVP de plataforma para personal trainers criarem e administrarem termos digitais com seus alunos.'
    else case_context end,
  case_problem = case when nullif(btrim(case_problem), '') is null
    then 'Registrar versões, convites e aceites de forma rastreável, preservando o conteúdo aceito em cada momento.'
    else case_problem end,
  case_solution = case when nullif(btrim(case_solution), '') is null
    then 'Fluxo de termos versionados, convites, aceite, snapshots, comprovantes e hash SHA-256 apoiado por Supabase.'
    else case_solution end,
  case_result = case when nullif(btrim(case_result), '') is null
    then 'O MVP demonstra rastreabilidade do aceite, versionamento imutável e geração de comprovantes dentro de um fluxo SaaS.'
    else case_result end,
  project_url = case when nullif(btrim(project_url), '') is null then './termo-digital-demo/' else project_url end,
  preview_url = case when nullif(btrim(preview_url), '') is null then './termo-digital-demo/?embed=spaceunderground' else preview_url end,
  live_preview_enabled = true,
  translations = coalesce(translations, '{}'::jsonb) || jsonb_build_object(
    'en',
    coalesce(translations -> 'en', '{}'::jsonb) || jsonb_build_object(
      'case_context', 'MVP platform for personal trainers to create and manage digital agreements with their clients.',
      'case_problem', 'Record versions, invitations and acceptances with traceability while preserving exactly what was accepted at each point in time.',
      'case_solution', 'A flow for versioned agreements, invitations, acceptance, snapshots, receipts and SHA-256 hashes backed by Supabase.',
      'case_result', 'The MVP demonstrates acceptance traceability, immutable versioning and receipt generation inside a SaaS workflow.'
    )
  )
where case_number = 5;

-- Anon uses column-level SELECT after the clients privacy hardening. Re-issue
-- the complete public grant so the new columns can be selected without exposing
-- projects.client_id or any other admin-only field.
grant select (
  id,
  case_number,
  name,
  slug,
  client,
  category,
  description,
  status,
  editorial_status,
  featured,
  visible,
  year,
  accent,
  tech_stack,
  poster_url,
  project_url,
  preview_url,
  created_at,
  updated_at,
  published_at,
  presentation_system,
  presentation_label,
  presentation_address,
  presentation_type,
  origin,
  coordinates,
  translations,
  live_preview_enabled,
  case_kind,
  case_context,
  case_problem,
  case_solution,
  case_result
) on public.projects to anon;
