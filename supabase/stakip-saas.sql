-- ═══════════════════════════════════════════════════════════════
--  STAKİP — SaaS (çok mağazalı) veritabanı kurulumu
--  Supabase → SQL Editor → yapıştır → Run
--  Tekrar tekrar çalıştırılabilir (idempotent).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. TABLOLAR ────────────────────────────────────────────────

-- Her kayıt olan kullanıcı için bir mağaza.
create table if not exists public.stores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Mağaza ↔ kullanıcı bağı. Şimdilik tek sahip; ileride ortak eklemek için hazır.
create table if not exists public.store_members (
  store_id   uuid not null references public.stores(id) on delete cascade,
  user_id    uuid not null references auth.users(id)    on delete cascade,
  role       text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

-- Mağazanın tüm verisi. Eski company_inventory ile aynı şema,
-- tek farkı: metin "channel" yerine mağazaya bağlı store_id.
create table if not exists public.store_data (
  store_id        uuid primary key references public.stores(id) on delete cascade,
  products        jsonb not null default '[]'::jsonb,
  suppliers       jsonb not null default '[]'::jsonb,
  orders          jsonb not null default '[]'::jsonb,
  sales_history   jsonb not null default '[]'::jsonb,
  stockin_history jsonb not null default '[]'::jsonb,
  users           jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now()
);

create index if not exists stores_owner_idx        on public.stores(owner_id);
create index if not exists store_members_user_idx  on public.store_members(user_id);

-- ── 2. ÜYELİK KONTROLÜ ─────────────────────────────────────────
-- SECURITY DEFINER: store_members üzerindeki RLS'i atlar.
-- Bu olmasaydı "üyeliği görmek için üye olmak gerekir" döngüsü oluşurdu.
create or replace function public.is_store_member(sid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.store_members m
    where m.store_id = sid and m.user_id = auth.uid()
  );
$$;

-- ── 3. RLS — ASIL GÜVENLİK SINIRI ──────────────────────────────
-- Tarayıcıdaki publishable key herkese açık. Mağazaları birbirinden
-- ayıran tek şey aşağıdaki politikalar.

alter table public.stores        enable row level security;
alter table public.store_members enable row level security;
alter table public.store_data    enable row level security;

drop policy if exists stores_select        on public.stores;
drop policy if exists stores_update        on public.stores;
drop policy if exists store_members_select on public.store_members;
drop policy if exists store_data_all       on public.store_data;

-- Kendi mağazanı gör
create policy stores_select on public.stores
  for select using (public.is_store_member(id));

-- Mağaza adını sadece sahibi değiştirebilir
create policy stores_update on public.stores
  for update using (owner_id = auth.uid())
              with check (owner_id = auth.uid());

-- Kendi üyelik satırlarını gör (özyineleme yok: auth.uid() doğrudan)
create policy store_members_select on public.store_members
  for select using (user_id = auth.uid());

-- Mağaza verisini yalnızca üyeleri okur/yazar
create policy store_data_all on public.store_data
  for all using (public.is_store_member(store_id))
          with check (public.is_store_member(store_id));

-- INSERT politikası bilerek yok: mağaza YALNIZCA aşağıdaki
-- create_store() fonksiyonuyla açılabilir. Kimse elle satır ekleyemez.

-- ── 4. KAYIT: MAĞAZA AÇMA ──────────────────────────────────────
-- Kayıt olan kullanıcı için mağaza + üyelik + boş veri satırını
-- tek işlemde oluşturur. Zaten mağazası varsa onu döndürür.
create or replace function public.create_store(store_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  if auth.uid() is null then
    raise exception 'Oturum açılmamış';
  end if;

  select s.id into sid
    from public.stores s
   where s.owner_id = auth.uid()
   limit 1;

  if sid is not null then
    return sid;                       -- iki kez çağrılırsa ikinci mağaza açma
  end if;

  insert into public.stores (name, owner_id)
  values (coalesce(nullif(btrim(store_name), ''), 'Mağazam'), auth.uid())
  returning id into sid;

  insert into public.store_members (store_id, user_id, role)
  values (sid, auth.uid(), 'owner');

  insert into public.store_data (store_id)
  values (sid);

  return sid;
end;
$$;

revoke all on function public.create_store(text) from public, anon;
grant execute on function public.create_store(text) to authenticated;
grant execute on function public.is_store_member(uuid) to authenticated;

-- ── 5. REALTIME ────────────────────────────────────────────────
-- Cihazlar arası anlık yayılım için store_data'yı yayına ekle.
do $$
begin
  alter publication supabase_realtime add table public.store_data;
exception
  when duplicate_object then null;
end;
$$;

-- Realtime satır verisini de RLS'e tabi tut (aksi halde değişiklik
-- olayları abone olan herkese gider).
alter table public.store_data replica identity full;

-- ── 6. KONTROL ─────────────────────────────────────────────────
-- Aşağıdaki sorgu 3 tablo ve 4 politika göstermeli.
select
  (select count(*) from pg_tables  where schemaname = 'public'
     and tablename in ('stores','store_members','store_data'))            as tablo_sayisi,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('stores','store_members','store_data'))            as politika_sayisi,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('create_store','is_store_member'))
                                                                          as fonksiyon_sayisi;
