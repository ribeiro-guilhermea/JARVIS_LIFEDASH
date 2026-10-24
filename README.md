# Jarvis + Life Dashboard

Sistema pessoal para organizar a vida em sete áreas, executar a semana com clareza e guardar ideias e decisões fora da cabeça.

- **Life Dashboard**: painel web com a semana, prioridades, tarefas (com subtarefas), hábitos, XP, níveis e revisão semanal.
- **Jarvis**: assistente que consulta e altera o painel e as notas. Funciona de duas formas:
  - **modo básico no Telegram** (sem IA, custo zero, comandos como `/hoje`, `/tarefa`, `/ideia`);
  - **modo conversa** com o [Hermes Agent](https://github.com/NousResearch/hermes-agent), que usa as ferramentas do Jarvis via MCP (precisa de um modelo de IA; veja custos em [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)).
- **Obsidian**: memória de longo prazo em arquivos Markdown (`ideias/`, `projetos/`, `decisoes/`, `desempenho/`, `rotinas/`).

Tudo roda num único programa Node.js, no seu computador, sem serviços pagos obrigatórios e sem dependências externas para instalar.

## Requisitos

- **Node.js 22.13 ou mais novo** (recomendado: a versão LTS atual em <https://nodejs.org>). É a única coisa a instalar.
- Git (para baixar e atualizar o projeto) — ou baixe o ZIP pelo GitHub.

## Instalação (uma vez)

1. Baixe o projeto:
   ```
   git clone https://github.com/ribeiro-guilhermea/JARVIS_LIFEDASH.git
   cd JARVIS_LIFEDASH
   ```
2. Crie sua configuração copiando o exemplo:
   - Windows (Prompt de Comando): `copy .env.example .env`
   - Mac/Linux: `cp .env.example .env`
3. Abra o arquivo `.env` num editor de texto e preencha pelo menos `OBSIDIAN_VAULT_PATH` (caminho da pasta do seu vault). O resto pode ficar como está.
4. Confira se está tudo certo:
   ```
   npm run doctor
   ```

Não há `npm install`: o projeto não tem dependências externas.

## Uso diário

```
npm start
```

Depois abra <http://localhost:4310>. Deixe o terminal aberto enquanto usa; para encerrar, `Ctrl+C`.

Atalhos de duplo clique: `scripts/iniciar-windows.bat` (Windows) e `scripts/iniciar-mac.command` (Mac).

Tela cheia: botão ⛶ no canto superior direito, ou `F11` no Windows. No iPhone, use "Compartilhar → Adicionar à Tela de Início" (depois de configurar o acesso pela rede, ver [docs/OPERATIONS.md](docs/OPERATIONS.md)).

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Abre o painel (e o bot do Telegram, se configurado) |
| `npm test` | Roda os testes automáticos |
| `npm run doctor` | Diagnóstico da configuração |
| `npm run backup` | Backup do banco de dados |
| `npm run backup:vault` | Backup do banco + cópia do vault do Obsidian |
| `npm run backups` | Lista os backups |
| `npm run restore -- <arquivo>` | Restaura um backup (com o painel fechado) |
| `npm run mcp` | Servidor MCP do Jarvis (quem roda é o Hermes, não você) |

## Onde ficam os dados

- **Tarefas, hábitos, XP, revisões**: `data/lifedash.db` (SQLite, um arquivo só). Fora do Git.
- **Backups**: `backups/` (automático diário + manuais). Fora do Git. Recomendado apontar `BACKUP_DIR` para uma pasta sincronizada (OneDrive/Google Drive/iCloud).
- **Ideias e conhecimento**: no seu vault do Obsidian.
- **Senhas e tokens**: só no `.env`, que nunca vai para o GitHub.

## Documentação

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — como as peças se encaixam
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — entidades, hierarquia e regras de XP
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — Obsidian, Telegram, Hermes Agent (passo a passo e custos)
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — execução, acesso pelo iPhone/Mac, backup e restauração
- [docs/DECISIONS.md](docs/DECISIONS.md) — decisões técnicas e o que ficou para depois
- [docs/STATUS.md](docs/STATUS.md) — o que está pronto, o que foi testado e o que depende de configuração
