do $migration$
declare
  v_secret_count bigint;
begin
  if not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pg_cron'
  ) then
    raise exception 'pg_cron extension is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pg_net'
  ) then
    raise exception 'pg_net extension is required';
  end if;

  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault decrypted_secrets view is required';
  end if;

  select pg_catalog.count(*)
  into v_secret_count
  from vault.decrypted_secrets
  where name = 'zeshu_support_whatsapp_cron_secret';

  if v_secret_count = 0 then
    raise exception 'required WhatsApp scheduler Vault secret does not exist';
  end if;

  if v_secret_count > 1 then
    raise exception 'multiple WhatsApp scheduler Vault secrets exist';
  end if;

  if exists (
    select 1
    from cron.job
    where jobname = 'zeshu-support-whatsapp-every-5-minutes'
  ) then
    raise exception 'WhatsApp support scheduler job already exists';
  end if;
end;
$migration$;

select cron.schedule(
  'zeshu-support-whatsapp-every-5-minutes',
  '*/5 * * * *',
  $cron$
  do $job$
  declare
    v_cron_secret text;
  begin
    select decrypted_secret
    into strict v_cron_secret
    from vault.decrypted_secrets
    where name = 'zeshu_support_whatsapp_cron_secret';

    if v_cron_secret is null or pg_catalog.btrim(v_cron_secret) = '' then
      raise exception 'required WhatsApp scheduler Vault secret is empty';
    end if;

    perform net.http_get(
      url := 'https://zeshu.in/api/cron/support-whatsapp',
      headers := pg_catalog.jsonb_build_object(
        'Authorization',
        'Bearer ' || v_cron_secret
      ),
      timeout_milliseconds := 90000
    );
  end;
  $job$;
  $cron$
);