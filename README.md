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

## Publicar no GitHub

1. Cria um repositório privado chamado `wedding4ever`.
2. Envia este código para o ramo `main`.
3. O GitHub Actions corre os testes e publica a imagem em `ghcr.io/<utilizador>/wedding4ever`.

## Instalar no Portainer

1. Em **Registries**, adiciona `ghcr.io` com o teu utilizador do GitHub e um token com `read:packages`.
2. Em **Stacks**, cria uma stack com o conteúdo de `docker-compose.yml`.
3. Define as variáveis:

| Variável | Valor |
| --- | --- |
| `GITHUB_OWNER` | Utilizador do GitHub, em minúsculas |
| `PUBLIC_URL` | Endereço público, por exemplo `https://wedding4ever.pt` |
| `POSTGRES_PASSWORD` | Resultado de `openssl rand -hex 32` |
| `APP_SECRET` | Outro resultado de `openssl rand -hex 32` |
| `ADMIN_EMAIL` | O teu e-mail |
| `ADMIN_PASSWORD` | Pelo menos 12 caracteres |
| `APP_PORT` | Opcional, 3000 por predefinição |

4. Abre `PUBLIC_URL/admin`.

Guarda o `APP_SECRET` num local seguro. Se mudar, a aplicação deixa de conseguir entrar nas bases dos clientes.

`PUBLIC_URL` tem de ser igual ao endereço usado no browser, porque os formulários são recusados quando a origem não coincide.

## Atualização automática

Ativa o webhook da stack no Portainer e guarda o URL como segredo `PORTAINER_WEBHOOK_URL` no GitHub. Esse endereço tem de estar acessível a partir da internet. Se o Portainer só estiver disponível em casa, publica apenas o webhook através do Cloudflare Tunnel, ou atualiza a stack manualmente com a opção de obter a imagem mais recente.

## Alterar a base de dados

Adiciona um ficheiro numerado, nunca alteres um já aplicado:

- `src/db/migrations/central/003_nome.sql` para a base central
- `src/db/migrations/event/002_nome.sql` para as bases dos clientes

No arranque, a aplicação aplica as migrações em falta em todas as bases. Se uma falhar, o erro aparece na página desse cliente e os restantes continuam.
