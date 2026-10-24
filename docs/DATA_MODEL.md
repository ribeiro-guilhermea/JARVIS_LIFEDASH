# Modelo de dados

Banco SQLite em `DATA_DIR/lifedash.db`. Esquema em `src/core/db.js` (migrações numeradas em `schema_migrations`).

## Hierarquia

```
Área de vida ─┬─ Objetivo ── Meta ── Projeto ──┐
              │                                ├── Tarefa ── Subtarefa ── Microtarefa
              └────────────────────────────────┘
```

Todos os níveis acima da tarefa são **opcionais**. Uma tarefa pode existir sozinha, só com área, ligada a um projeto, a uma meta, ou a nada.

## Entidades

| Tabela | Para que serve | Campos principais |
|---|---|---|
| `areas` | As 7 áreas iniciais (editáveis pela tela Ajustes) | `slug`, `name`, `icon`, `color`, `sort_order`, `active` |
| `objectives` | Objetivo amplo dentro de uma área | `area_id`, `title`, `status`, `note_path` |
| `goals` | Meta mensurável, opcionalmente ligada a um objetivo | `area_id`, `objective_id?`, `target_date?`, `status`, `note_path` |
| `projects` | Projeto ou atividade relevante, opcionalmente ligado a uma meta | `area_id`, `goal_id?`, `status`, `note_path` |
| `tasks` | Tarefas, subtarefas e microtarefas (mesma tabela) | `parent_id?`, `granularity`, `area_id?`, `project_id?`, `goal_id?`, `status`, `is_priority`, `effort`, `planned_date`, `due_date`, `completed_at`, `source` |
| `habits` | Hábitos recorrentes | `area_id?`, `title`, `target_per_week` (1–7), `active` |
| `habit_checks` | Um registro por hábito por dia feito | `habit_id`, `date` (único por hábito+dia) |
| `xp_ledger` | Livro-razão de XP (somente inclusão) | `amount`, `kind`, `category`, `task_id?`, `habit_id?`, `review_id?`, `reverses_id?`, `note` |
| `weekly_reviews` | Revisão semanal (uma por semana) | `week_start`, `wins`, `difficulties`, `lessons`, `next_focus`, `snapshot`, `note_path` |
| `seasons` | Temporadas com meta de XP (opcional) | `name`, `start_date`, `end_date`, `xp_goal` |
| `activity_log` | Histórico de alterações | `entity`, `entity_id`, `action`, `source`, `details` (JSON com "de/para") |
| `settings` | Regras de gamificação (JSON) | `key = 'rules'` |

Status: tarefas `pending | done | cancelled`; objetivos/metas/projetos `active | paused | done | dropped`. Nada é apagado pela interface ou pelo Jarvis: tarefas são **canceladas**, áreas e hábitos são **desativados**.

### Tarefas, subtarefas e microtarefas

- `granularity` é definido pela posição: sem pai = `task`; filho de `task` = `subtask`; filho de `subtask` = `micro`. Microtarefas não têm filhos.
- Subdivisões herdam área, projeto e meta da tarefa-mãe.
- Concluir uma tarefa com subdivisões pendentes exige confirmação; elas são concluídas junto, **sem XP próprio**.
- Reabrir uma subdivisão exige que a tarefa-mãe esteja pendente.

### Data planejada × prazo

- `planned_date`: quando você pretende trabalhar na tarefa. Define em que dia ela aparece na semana.
- `due_date`: até quando precisa estar pronta. Se passou e a tarefa está pendente, ela vai para "Prazo vencido".
- Tarefa pendente com data planejada em semana anterior (e prazo não vencido) aparece em "Ficaram de semanas anteriores".

## XP e níveis

### Regras padrão (editáveis em Ajustes)

| Evento | XP |
|---|---|
| Tarefa pequena / média / grande (`effort` 1/2/3) | 10 / 20 / 40 |
| Subtarefa / microtarefa | 4 / 2, com **teto diário de 30 XP** somando todas as subdivisões |
| Hábito marcado no dia | 5 |
| Revisão semanal (primeira vez na semana) | 30 |

O teto existe para que dividir tarefas ajude a executar, sem virar um jeito de "fabricar" pontos. O XP principal vem do tamanho real da tarefa.

Nível N exige `level_base × (N−1) × N ÷ 2` XP acumulado (com base 100: nível 2 = 100, nível 3 = 300, nível 4 = 600, nível 5 = 1000…). Títulos: Aprendiz (1), Praticante (3), Disciplinado (5), Construtor (8), Estrategista (12), Mestre de si (17), Lenda (25).

### Auditoria

- `xp_ledger` é **somente inclusão**: o próprio banco recusa `UPDATE` e `DELETE` (gatilhos).
- O saldo é sempre a soma dos lançamentos; não existe um "saldo" editável.
- Reabrir uma tarefa ou desmarcar um hábito cria um lançamento negativo que aponta (`reverses_id`) para o lançamento original. Cada lançamento só pode ser estornado uma vez (`reverses_id` único).
- Concluir uma tarefa já concluída não faz nada.
- Correções manuais são lançamentos `adjustment` com motivo obrigatório.
- Mudar as regras vale só para lançamentos futuros; o histórico não é recalculado.

## Notas do Obsidian

Formato criado pelo Jarvis:

```markdown
---
id: 20261024-a1b2c3
tipo: ideia
criado: 2026-10-24
atualizado: 2026-10-24
status: aberta
tags: [sterling, telegram]
---
# Título da nota

Conteúdo.

## Atualização 2026-10-30 14:05

Texto acrescentado depois (nunca substitui o anterior).

## Relacionadas

- [[Outra nota]]
```

Tipos e pastas: `ideia → ideias/`, `projeto → projetos/`, `decisao → decisoes/`, `desempenho → desempenho/`, `rotina → rotinas/`. Você pode editar as notas à mão normalmente; se o cabeçalho YAML for mais complexo do que o formato acima, o Jarvis não o reescreve (só acrescenta texto ao final).
