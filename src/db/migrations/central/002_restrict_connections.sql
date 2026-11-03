-- As contas dos clientes só podem entrar na sua própria base.
DO $$
DECLARE
  target text;
BEGIN
  FOR target IN
    SELECT datname FROM pg_database WHERE datname IN (current_database(), 'postgres', 'template1')
  LOOP
    EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', target);
  END LOOP;
END $$;
