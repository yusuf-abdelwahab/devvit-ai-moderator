
create extension if not exists vector;

create table if not exists public.policy_chunks (
  id text primary key,
  text text not null,
  category text not null,
  visibility text not null
    check (visibility in ('public', 'private')),
  source text not null,
  embedding vector(768) not null
);

-- Policy content is server-only.
alter table public.policy_chunks enable row level security;

revoke all on table public.policy_chunks
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.policy_chunks to service_role;

create index if not exists policy_chunks_embedding_idx
  on public.policy_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 10);

-- Remove the old, unfiltered function signature.
drop function if exists public.match_policy_chunks(
  vector,
  double precision,
  integer
);

create or replace function public.match_policy_chunks(
  query_embedding vector(768),
  match_threshold double precision,
  match_count integer,
  match_visibility text
)
returns table (
  id text,
  text text,
  category text,
  visibility text,
  source text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.text,
    p.category,
    p.visibility,
    p.source,
    (1 - (p.embedding <=> query_embedding))::double precision
      as similarity
  from public.policy_chunks p
  where p.visibility = match_visibility
    and match_visibility in ('public', 'private')
    and 1 - (p.embedding <=> query_embedding) >= match_threshold
  order by p.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 12);
$$;

-- Only the server-side service role may search.
revoke all on function public.match_policy_chunks(
  vector,
  double precision,
  integer,
  text
) from public, anon, authenticated;

grant execute on function public.match_policy_chunks(
  vector,
  double precision,
  integer,
  text
) to service_role;
