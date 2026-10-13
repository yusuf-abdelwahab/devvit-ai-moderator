create extension if not exists vector;

create table if not exists policy_chunks (
  id text primary key,
  text text not null,
  category text not null,
  visibility text not null check (visibility in ('public', 'private')),
  source text not null,
  embedding vector(768) not null
);

create index if not exists policy_chunks_embedding_idx
on policy_chunks using ivfflat (embedding vector_cosine_ops)
with (lists = 10);

create or replace function match_policy_chunks(
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id text,
  text text,
  category text,
  visibility text,
  source text,
  similarity float
)
language sql stable
as $$
  select
    p.id,
    p.text,
    p.category,
    p.visibility,
    p.source,
    1 - (p.embedding <=> query_embedding) as similarity
  from policy_chunks p
  where 1 - (p.embedding <=> query_embedding) >= match_threshold
  order by p.embedding <=> query_embedding
  limit match_count;
$$;
