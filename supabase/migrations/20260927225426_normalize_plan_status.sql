-- Normalizes plan lifecycle status text after compatible code is deployed.
-- Data-only, idempotent, limited to public.plans.

update public.plans
set status = case
  when upper(trim(status)) in ('AVAILABLE', 'DISPONÍVEL', 'DISPONIVEL') then 'AVAILABLE'
  when upper(trim(status)) in ('LIMITED', 'LIMITADO') then 'LIMITED'
  when upper(trim(status)) in ('ON_REQUEST', 'ON REQUEST', 'SOB CONSULTA') then 'ON_REQUEST'
  when upper(trim(status)) in ('WAITLIST', 'LISTA DE ESPERA') then 'WAITLIST'
  when upper(trim(status)) in ('UNAVAILABLE', 'INDISPONÍVEL', 'INDISPONIVEL') then 'UNAVAILABLE'
  when upper(trim(status)) in ('ARCHIVED', 'ARQUIVADO') then 'ARCHIVED'
  else status
end
where status is not null
  and status is distinct from case
    when upper(trim(status)) in ('AVAILABLE', 'DISPONÍVEL', 'DISPONIVEL') then 'AVAILABLE'
    when upper(trim(status)) in ('LIMITED', 'LIMITADO') then 'LIMITED'
    when upper(trim(status)) in ('ON_REQUEST', 'ON REQUEST', 'SOB CONSULTA') then 'ON_REQUEST'
    when upper(trim(status)) in ('WAITLIST', 'LISTA DE ESPERA') then 'WAITLIST'
    when upper(trim(status)) in ('UNAVAILABLE', 'INDISPONÍVEL', 'INDISPONIVEL') then 'UNAVAILABLE'
    when upper(trim(status)) in ('ARCHIVED', 'ARQUIVADO') then 'ARCHIVED'
    else status
  end;
