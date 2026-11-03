# Wedding4Ever

Plataforma para a Batalha da Melhor Foto. Uma única aplicação serve todos os clientes, e cada evento tem a sua própria base de dados e o seu próprio utilizador PostgreSQL.

## Estado atual

Passo 1 concluído:

- Painel de administração com login
- Criação e eliminação de clientes
- Base de dados, link, QR Code e cartões de mesa em PDF por cliente
- Estados do evento e página pública do convidado
- Migrações automáticas em todas as bases

Ainda por fazer: registo de convidados, envio de fotografias, ranking, votação, e-mails, painel dos noivos e exportação em ZIP.

## Tecnologia

Bun e TypeScript, sem pacotes de produção. O PostgreSQL 16 guarda uma base central e uma base por evento.

## Desenvolvimento

```bash
cp .env.example .env
bun run dev
```

Em desenvolvimento, usa `PUBLIC_URL=http://localhost:3000` e um `DATABASE_URL` com permissão para criar bases e utilizadores.

Para correr os testes é preciso um PostgreSQL local. Os testes apagam a base `w4e_test` e todas as bases e utilizadores `evt_*` desse servidor, por isso usa apenas um servidor de testes:

```bash
TEST_POSTGRES_URL=postgres://postgres:test@127.0.0.1:5432/postgres bun test
```

## Instalar no Portainer

1. Em **Stacks**, cria uma stack a partir do repositório, com o ramo `refs/heads/main` e o ficheiro `docker-compose.yml`.
2. Define as variáveis `PUBLIC_URL`, `POSTGRES_PASSWORD`, `APP_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e, se quiseres, `APP_PORT`.
3. Faz o deploy e abre `PUBLIC_URL/admin`.

O servidor constrói a aplicação para o seu próprio processador. Para atualizar, usa **Pull and redeploy** na stack.

`APP_SECRET` tem pelo menos 32 caracteres e não pode mudar depois de criares clientes. `PUBLIC_URL` tem de ser igual ao endereço usado no browser.

## Alterar a base de dados

Adiciona um ficheiro numerado, nunca alteres um já aplicado:

- `src/db/migrations/central/003_nome.sql` para a base central
- `src/db/migrations/event/002_nome.sql` para as bases dos clientes

No arranque, a aplicação aplica as migrações em falta em todas as bases. Se uma falhar, o erro aparece na página desse cliente e os restantes continuam.
