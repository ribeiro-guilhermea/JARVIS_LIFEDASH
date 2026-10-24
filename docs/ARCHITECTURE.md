# Arquitetura

## Visão geral

Um único processo Node.js, um único banco SQLite, uma pasta de arquivos Markdown (o vault). Sem microsserviços, sem filas, sem nuvem.

```
                ┌────────────────────────── npm start (um processo) ──────────────────────────┐
 Navegador ───► │  src/dashboard/server.js   API JSON + interface (public/)                    │
 (PC, Mac,      │          │                                                                   │
  iPhone)       │          ▼                                                                   │
                │  src/core/service.js  ── regras de negócio, validação, XP ──► data/lifedash.db │
                │          │                                                                   │
                │  src/obsidian/vault.js ── ler/buscar/criar/acrescentar ──► vault (Markdown)  │
                │          ▲                                                                   │
 Telegram ◄────►│  src/jarvis/telegram-bot.js  (modo básico, opcional)                         │
                │  src/backup/  backup automático diário                                       │
                └──────────────────────────────────────────────────────────────────────────────┘
                           ▲ HTTP local (127.0.0.1)
 Telegram ◄──► Hermes Agent ──► src/jarvis/mcp-server.js  (processo iniciado pelo Hermes, via stdio)
               (modelo de IA)
```

## Responsabilidades

| Pasta | Responsabilidade |
|---|---|
| `src/core/` | Banco (`db.js`, migrações), regras de negócio (`service.js`), regras de gamificação (`rules.js`), datas (`dates.js`). **Único lugar que grava dados operacionais e lança XP.** |
| `src/dashboard/` | Servidor HTTP: API JSON + arquivos da interface (`public/`, HTML/CSS/JS sem etapa de build). Aplica as proteções de acesso. |
| `src/obsidian/` | Integração com o vault: leitura, busca tolerante, criação, acréscimo, ligação entre notas, histórico de versões. Nunca apaga. |
| `src/jarvis/` | Interfaces do Jarvis: servidor MCP (para o Hermes), bot do Telegram em modo básico, interpretador de datas em português. |
| `src/backup/` | Backup consistente (com o painel aberto), verificação, restauração com cópia de segurança, cópia do vault. |
| `scripts/` | Diagnóstico (`doctor.js`) e atalhos de inicialização. |
| `tests/` | Testes automáticos (`npm test`) e teste de interface opcional (`tests/e2e/`). |

Não existem `apps/` e `packages/` separados: com um único processo e um único banco, essa divisão só criaria camadas vazias (ver [DECISIONS.md](DECISIONS.md)).

## Regra central: um só caminho de gravação

Toda alteração de dados operacionais — vinda da tela, do Telegram ou do Hermes — passa por `src/core/service.js`:

- A interface chama a API HTTP, que chama o `service`.
- O bot do Telegram (modo básico) roda no mesmo processo e chama o `service` diretamente.
- O servidor MCP **não** abre o banco: ele chama a mesma API HTTP. Assim a IA nunca escreve no banco ou nos arquivos sem passar pela validação, e o painel continua sendo o único "dono" do arquivo SQLite.

O MCP expõe um conjunto fechado de ferramentas. Não há ferramenta para apagar nada; concluir uma tarefa com subdivisões pendentes exige confirmação explícita; datas precisam estar no formato AAAA-MM-DD (o Jarvis usa a ferramenta `interpretar_data`, que é determinística e diz quando a data é ambígua).

Cada alteração registra a origem (`dashboard`, `jarvis` ou `telegram`) no histórico (`activity_log`).

## Conhecimento × dados operacionais

| Tipo | Onde fica | Exemplos |
|---|---|---|
| Operacional (estruturado, com status, datas, XP) | SQLite do painel | tarefas, hábitos, metas, conclusões, lançamentos de XP, revisões |
| Conhecimento (texto livre, contexto) | Vault do Obsidian | ideias, decisões, histórico de projetos, aprendizados, revisões em texto |

A ligação entre os dois lados é feita por referência, não por cópia: objetivos, metas e projetos têm um campo `note_path` (caminho da nota no vault); tarefas podem citar a nota de origem nas observações. A ferramenta `contexto_projeto` junta os dois lados na hora da consulta.

## Segurança (resumo)

- Por padrão o painel só aceita conexões do próprio computador (`HOST=127.0.0.1`).
- Abrir para a rede exige `ACCESS_TOKEN`; o programa se recusa a iniciar sem ele.
- Sem senha, só são aceitas requisições com `Host: localhost` (bloqueia ataques de "DNS rebinding").
- Gravações exigem `Content-Type: application/json` e origem igual ao próprio painel (bloqueia sites de terceiros).
- O bot do Telegram ignora qualquer usuário fora de `JARVIS_TELEGRAM_ALLOWED_USERS` e não inicia sem essa lista.
- O vault: leitura só dentro da pasta configurada (sem `..`, sem pastas ocultas); gravação só nas cinco pastas de conhecimento.
- Credenciais só no `.env` (fora do Git).
