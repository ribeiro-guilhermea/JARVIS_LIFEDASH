# Status da versão 0.1.0

Separação honesta entre o que está **implementado**, o que foi **testado** e o que **depende de você** configurar.

## Implementado e testado

| Item | Como foi validado |
|---|---|
| 7 áreas iniciais, editáveis sem código | testes + tela Ajustes |
| Objetivos, metas, projetos por área | tela de área |
| Tarefas, subtarefas, microtarefas (mesma entidade) | testes de hierarquia + divisão em passos pela tela |
| Data planejada e prazo separados | testes + visão semanal |
| Visão semanal, prioridades, prazo vencido, "ficaram de semanas anteriores", sem data | testes + navegador |
| XP, níveis, títulos, temporadas, regras configuráveis | testes |
| XP não duplica; estorno explícito ao reabrir; livro de XP imutável | testes (inclusive tentativa de `UPDATE`/`DELETE` direto no banco) |
| Teto de XP para subdivisões | teste com 20 subtarefas |
| Hábitos com estorno ao desmarcar | testes + navegador |
| Revisão semanal (XP uma vez por semana) + nota no Obsidian | testes + navegador |
| Histórico de alterações com origem (painel/Jarvis/Telegram) | testes |
| Persistência após reiniciar | teste com banco em arquivo + reinício real do servidor no teste de interface |
| Interface responsiva | Chromium em 1366×900 e 390×844 (largura de iPhone), sem rolagem horizontal, sem erros de JavaScript |
| Obsidian: criar, ler, buscar, acrescentar, relacionar, histórico de versões, bloqueio de caminhos | testes com vault temporário |
| Interpretação de datas em português | testes |
| Servidor MCP do Jarvis | testes + validado com o **cliente MCP oficial** (`@modelcontextprotocol/sdk`): inicialização, lista de ferramentas, chamadas, modo somente leitura |
| Modo básico do Telegram (lógica dos comandos) | testes |
| Backup, verificação, restauração com cópia de segurança, recusa com painel aberto | testes + execução real dos comandos `npm run backup/restore` |
| Proteções de acesso (senha, origem, host, JSON) | testes |

Resultado atual: `npm test` → **52 testes, 52 passando**. Teste de interface (`tests/e2e/ui-smoke.mjs`) → **10 verificações, todas passando**.

## Implementado, mas NÃO validado no ambiente real

| Item | Por quê | Como validar |
|---|---|---|
| Funcionamento no Windows, Mac e iPhone reais | o desenvolvimento rodou em Linux; o iPhone foi simulado só pela largura de tela no Chromium (não é Safari) | instalar e abrir em cada dispositivo |
| Conexão real com o Telegram (modo básico) | precisa do seu token do BotFather | INTEGRATIONS.md §2 |
| Hermes Agent conversando com as ferramentas | Hermes não instalado aqui; documentação oficial inacessível deste ambiente | INTEGRATIONS.md §3 |
| Vault real do Obsidian | não há acesso ao seu vault; testado com pastas temporárias (o Obsidian lê esses mesmos arquivos `.md`) | configurar `OBSIDIAN_VAULT_PATH` e rodar `npm run doctor` |
| Acesso pela rede de casa / fora de casa | depende da sua rede e de configuração | OPERATIONS.md, "Acesso por outros dispositivos" |

## Depende de você

1. Instalar Node.js LTS no computador que vai rodar o painel.
2. Criar o `.env` e apontar `OBSIDIAN_VAULT_PATH`.
3. (Recomendado) Apontar `BACKUP_DIR` para uma pasta sincronizada com a nuvem.
4. (Opcional) Token do Telegram para o modo básico.
5. (Opcional) Instalar o Hermes Agent, escolher um modelo de IA (avaliando custo e privacidade) e conectar o MCP.

## Limitações conhecidas

- Busca nas notas é por palavras (tolerante a acentos e variações), não por significado.
- O painel e o Jarvis só funcionam com o computador ligado e o painel aberto.
- Acesso pela rede local é HTTP sem criptografia (adequado só em Wi-Fi doméstico protegido).
- Só a revisão semanal está ativa; as demais frequências ficaram para depois.
