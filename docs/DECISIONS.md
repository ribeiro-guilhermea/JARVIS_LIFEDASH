# Decisões técnicas

Formato: decisão → por quê → o que se perde.

## D1. Um único programa Node.js, sem dependências externas
**Por quê:** você precisa conseguir instalar e manter sozinho. Node.js roda igual em Windows, Mac e Linux, e as versões atuais já trazem servidor HTTP, SQLite (`node:sqlite`), testes (`node:test`) e leitura de `.env`. Resultado: nada de `npm install`, nada de pacotes quebrando em atualizações, nada de compilação nativa no Windows.
**Custo:** exige Node.js 22.13+. O `node:sqlite` ainda é marcado como "experimental" pelo Node (o aviso é suprimido nos scripts); se a API mudar, a troca para `better-sqlite3` afeta só `src/core/db.js` e `src/backup/backup.js`.

## D2. SQLite como fonte operacional
**Por quê:** um arquivo só, sem servidor de banco, transações reais, backup consistente com `VACUUM INTO`, gatilhos que impedem alterar o livro de XP.
**Custo:** um único processo deve gravar no banco — por isso o MCP passa pela API em vez de abrir o arquivo.

## D3. Interface em HTML/CSS/JS puro, sem framework e sem etapa de build
**Por quê:** carrega rápido em computador antigo, funciona em navegadores mais velhos (o código evita recursos muito recentes), e não há ferramenta de build para quebrar. O tamanho atual (6 telas) não justifica React/Vue.
**Custo:** se a interface crescer muito, um framework pode passar a compensar. A API já está separada, então a troca não afeta o resto.

## D4. Uma pasta `src/` com módulos, em vez de `apps/` + `packages/`
**Por quê:** existe um único processo e um único banco. Separar em pacotes criaria configuração e camadas vazias sem benefício. Os módulos (`core`, `dashboard`, `jarvis`, `obsidian`, `backup`) já isolam as responsabilidades.

## D5. Jarvis = Hermes Agent + servidor MCP próprio; modo básico sem IA como alternativa
**Por quê:** o Hermes já resolve Telegram, conversa e memória de sessão, é código aberto (MIT) e suporta MCP, que é um padrão aberto. Expor as capacidades como ferramentas MCP mantém a IA presa a ações validadas e permite trocar de agente no futuro sem reescrever nada. O modo básico (comandos no Telegram) entrega valor imediato com custo zero e continua útil se o modelo de IA estiver fora do ar ou ficar caro.
**Custo:** o modo conversacional depende de instalar o Hermes e escolher um modelo de IA (possível custo, ver INTEGRATIONS.md). Não foi testado com o Hermes real neste ambiente; o protocolo MCP foi validado com o cliente oficial do MCP.

## D6. O MCP fala com a API HTTP, nunca com o banco
**Por quê:** garante que toda gravação da IA passa pelas mesmas validações da tela, e mantém o painel como único dono do arquivo SQLite.
**Custo:** o painel precisa estar aberto para o Jarvis funcionar (a ferramenta avisa claramente quando não está).

## D7. XP como livro-razão somente inclusão
**Por quê:** pedido explícito de auditabilidade. O saldo é sempre a soma; estornos e ajustes são lançamentos visíveis; o banco recusa alterações.
**Custo:** nenhum relevante; o histórico cresce devagar (um registro por conclusão).

## D8. Anti-"farm" de XP
**Por quê:** subdividir ajuda a executar, mas não pode virar fábrica de pontos. Subdivisões valem pouco, têm teto diário somado, e concluir em cascata não dá XP aos filhos.

## D9. Obsidian só por arquivos, sem plugin
**Por quê:** o vault é uma pasta de Markdown; ler e escrever arquivos é o jeito mais simples e confiável, funciona com o Obsidian fechado e não depende de plugins da comunidade (ex.: Local REST API).
**Custo:** a busca é por palavras (tolerante a acentos e variações), não semântica. Para "ideia parecida" com palavras diferentes, o modelo de IA do Hermes compensa reformulando a busca.

## D10. Nada é apagado por Jarvis ou pela interface
**Por quê:** pedido explícito. Tarefas são canceladas, áreas e hábitos desativados, notas só recebem acréscimos (com cópia da versão anterior).

## D11. Segurança por padrão local
**Por quê:** é um sistema pessoal. Por padrão só aceita conexões do próprio computador; abrir para a rede exige senha; proteções contra sites de terceiros e "DNS rebinding" estão sempre ativas.

## Fica para depois (registrado, não construído)

- Revisões quinzenal, mensal, trimestral, semestral e anual (a estrutura de `weekly_reviews` + snapshot serve de modelo).
- Tarefas recorrentes (hoje, o que se repete é modelado como hábito).
- Busca semântica no vault (embeddings locais), se a busca por palavras se mostrar insuficiente.
- Lembretes proativos do Jarvis no Telegram (ex.: resumo às 7h) — o Hermes tem agendamento; avaliar depois que o uso básico estiver estável.
- Exportação CSV/JSON dos dados operacionais.
- HTTPS na rede local (hoje a recomendação é Tailscale para acesso remoto).
- CRM, leads, Instagram, vendas: fora do escopo por decisão sua.
