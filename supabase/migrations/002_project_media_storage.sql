-- Space Underground — project media storage
--
-- Creates the bucket that holds poster and gallery images, and the row level
-- security that governs it. Objects live at:
--
--   projects/{project_uuid}/poster/{uuid}.{ext}
--   projects/{project_uuid}/gallery/{uuid}.{ext}
--
-- The bucket is PRIVATE. Read access is derived from the owning project, so an
-- image of a draft project is unreachable even if someone guesses its path.
-- The admin UI and the public site both read through short-lived signed URLs,
-- which anon may create only for objects this policy already allows it to read.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-media',
  'project-media',
  false,
  5242880, -- 5 MB, enforced by the storage API as well as the client
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Path helper
-- ---------------------------------------------------------------------------
-- Extracts the project uuid from an object path. Returns null for anything
-- that does not match the expected layout, so a malformed path can never
-- accidentally satisfy a policy.
create or replace function public.media_project_id(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(object_name))[1] = 'projects'
     and (storage.foldername(object_name))[2] ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[2])::uuid
    else null
  end;
$$;

grant execute on function public.media_project_id(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies on storage.objects
-- ---------------------------------------------------------------------------
-- Admins manage every file in the bucket.
drop policy if exists project_media_admin_all on storage.objects;
create policy project_media_admin_all on storage.objects
  for all
  using (bucket_id = 'project-media' and public.is_admin())
  with check (bucket_id = 'project-media' and public.is_admin());

-- Everyone else may read an image only while its project is published and
-- visible. The subquery is itself filtered by the policies on public.projects.
drop policy if exists project_media_public_read on storage.objects;
create policy project_media_public_read on storage.objects
  for select
  using (
    bucket_id = 'project-media'
    and exists (
      select 1
      from public.projects p
      -- storage.objects.name must stay qualified: public.projects also has a
      -- "name" column, and inside this subquery it would shadow the object path.
      where p.id = public.media_project_id(storage.objects.name)
        and p.editorial_status = 'PUBLISHED'
        and p.visible = true
    )
  );

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
-- projects.poster_url and project_gallery.url hold either a storage path
-- (relative, no scheme — resolved to a signed URL at read time) or an absolute
-- URL for images hosted elsewhere. The admin decides which by inspecting the
-- value, so existing external URLs keep working.
comment on column public.projects.poster_url is
  'Storage path inside the project-media bucket, or an absolute URL for externally hosted images.';
comment on column public.project_gallery.url is
  'Storage path inside the project-media bucket, or an absolute URL for externally hosted images.';
