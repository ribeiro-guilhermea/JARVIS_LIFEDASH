# Integrações: Obsidian, Telegram e Hermes Agent

Cada seção diz **o que fazer, onde, por quê e como confirmar**. Nada aqui está configurado por padrão: tudo depende de você preencher o `.env` (e, no caso do Hermes, instalá-lo).

---

## 1. Obsidian (memória de longo prazo)

**Por quê:** é onde o Jarvis guarda e procura ideias, decisões, histórico de projetos e revisões. São arquivos `.md` comuns: continuam legíveis mesmo sem o Jarvis, sem IA e sem internet.

**O que fazer:**

1. Instale o Obsidian (<https://obsidian.md>, gratuito para uso pessoal) e crie ou abra um vault. Se já tem um, use o seu.
2. Descubra o caminho da pasta do vault: no Obsidian, clique com o botão direito numa nota → "Mostrar no Explorador/Finder". A pasta que contém a pasta `.obsidian` é o vault.
3. No arquivo `.env` do projeto, preencha:
   ```
   OBSIDIAN_VAULT_PATH=C:\Users\SeuNome\Documents\MeuVault
   ```
   (Mac: `/Users/seunome/Documents/MeuVault`; WSL: `/mnt/c/Users/SeuNome/Documents/MeuVault`.)
4. Reinicie o painel (`Ctrl+C` e `npm start`).

**Como confirmar:** `npm run doctor` mostra "✔ Vault: …" e "Pasta .obsidian encontrada". No painel, em **Ajustes → Obsidian**, aparece "Conectado"; o botão "Criar pastas que faltam" cria `ideias/`, `projetos/`, `decisoes/`, `desempenho/` e `rotinas/`.

**O que o Jarvis faz no vault:**

| Ação | Comportamento |
|---|---|
| Criar | Só nas cinco pastas; recusa título repetido na mesma pasta e aponta a nota existente |
| Ler | Qualquer nota `.md` do vault (exceto pastas ocultas como `.obsidian`) |
| Buscar | Ignora acentos e maiúsculas, aceita pedaços de palavra ("decis" acha "decisões"), ordena por relevância |
| Atualizar | Só **acrescenta** uma seção datada ao final; pode mudar `status`/`tags` do cabeçalho |
| Relacionar | Adiciona `[[links]]` na seção "Relacionadas" das duas notas |
| Apagar | **Não existe.** |

Antes de qualquer alteração, a versão anterior é copiada para `<vault>/.jarvis/historico/` (pasta oculta, não aparece no Obsidian nem nas buscas). Para recuperar, copie o arquivo de volta.

**Sincronização entre dispositivos:** o vault é só uma pasta. Se quiser vê-lo no iPhone, as opções gratuitas são iCloud Drive (Obsidian no iPhone lê vaults no iCloud) ou manter o vault no PC e usar Obsidian Sync (pago). O Jarvis precisa acessar a pasta **no computador onde o painel roda**.

---

## 2. Jarvis no Telegram — modo básico (sem IA, custo zero)

**Por quê:** permite consultar e registrar coisas pelo celular hoje, sem depender de modelo de IA nem de instalação extra. Funciona por comandos.

**O que fazer:**

1. No Telegram, abra o **@BotFather**, envie `/newbot`, escolha um nome e um usuário terminado em `bot`. Ele responde com um **token** (algo como `123456:ABC...`). Trate como senha.
2. Abra o **@userinfobot** e envie qualquer mensagem: ele responde com seu **ID numérico**.
3. No `.env`:
   ```
   JARVIS_TELEGRAM_BOT_TOKEN=123456:ABC...
   JARVIS_TELEGRAM_ALLOWED_USERS=987654321
   ```
4. Reinicie o painel.

**Como confirmar:** o terminal mostra `Telegram: @seu_bot (modo básico, 1 usuário(s) autorizado(s))`. Envie `/ajuda` para o bot.

**Comandos:**

| Comando | Exemplo |
|---|---|
| `/hoje` | O que está planejado hoje e o que tem prazo vencido |
| `/semana` | Prioridades, números da semana, XP e nível |
| `/pendentes [área]` | `/pendentes faculdade` |
| `/tarefa título \| data \| área` | `/tarefa !Estudar para a prova \| quinta \| faculdade` (o `!` marca prioridade) |
| `/feito número` | `/feito 12`. Com texto (`/feito dentista`), ele procura e pede confirmação |
| `/ideia título \| detalhes` | `/ideia Curso de orçamento \| para casais`. Se a nota já existe, acrescenta |
| `/buscar termos` | `/buscar decisão banco` |
| `/nota caminho` | `/nota ideias/Curso de orçamento` |
| `/projeto nome` | Tarefas do projeto + notas relacionadas |
| `/revisao` | Síntese da semana |
| `/xp` | Nível, título, quanto falta |

**Limitações:** só entende comandos; o painel precisa estar aberto (o bot roda dentro dele); mensagens de outros usuários são ignoradas. A conexão é feita pelo próprio painel consultando o Telegram (long polling), então **nada fica exposto na internet**.

---

## 3. Jarvis conversacional — Hermes Agent + MCP

**Por quê:** permite falar normalmente ("adicione uma tarefa para estudar para a prova na quinta"). O Hermes Agent (Nous Research, código aberto, licença MIT) cuida do Telegram e da conversa com o modelo de IA; este projeto fornece as **ferramentas** que ele pode usar, via MCP (Model Context Protocol).

### 3.1 O que precisa existir

1. **Life Dashboard aberto** (`npm start`) — o Jarvis consulta e grava por ele.
2. **Hermes Agent instalado.** Pelo README oficial ([github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)):
   - Windows (PowerShell): `iex (irm https://hermes-agent.nousresearch.com/install.ps1)`
   - Mac/Linux/WSL2: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`
3. **Um modelo de IA** configurado no Hermes (`hermes model`). Veja custos abaixo.
4. **Um bot do Telegram para o Hermes.** Use um bot **diferente** do modo básico, ou deixe o modo básico desligado (o Telegram entrega cada mensagem a um só programa).

> Aviso honesto: não consegui acessar o site de documentação do Hermes a partir do ambiente de desenvolvimento; as instruções abaixo vêm do README do repositório e de guias de configuração publicados. Os nomes de comandos podem mudar entre versões — se algo não bater, confira `hermes --help` e a documentação oficial.

### 3.2 Telegram no Hermes

Rode `hermes gateway setup`, escolha Telegram, informe o token do bot e seu ID numérico. Isso grava, em `~/.hermes/.env`:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USERS=987654321
```

Depois: `hermes gateway`. O Hermes recusa usuários fora da lista.

### 3.3 Conectar as ferramentas do Jarvis

Edite `~/.hermes/config.yaml` (no Windows, `C:\Users\SeuNome\.hermes\config.yaml`) e acrescente:

```yaml
mcp_servers:
  jarvis:
    command: "node"
    args:
      - "--disable-warning=ExperimentalWarning"
      - "C:\\Users\\SeuNome\\JARVIS_LIFEDASH\\src\\jarvis\\mcp-server.js"
```

Troque o caminho pelo local real do projeto (o `npm run doctor` mostra o comando exato). No Mac/Linux, use barras normais. Não é preciso repetir variáveis: o servidor MCP lê o `.env` do próprio projeto.

Se o Hermes rodar no **WSL2** e o painel no **Windows**, o `127.0.0.1` do WSL pode não alcançar o Windows. A forma mais simples é rodar o painel **no mesmo lugar** que o Hermes (os dois no Windows, ou os dois no WSL2).

Recarregue com `/reload-mcp` numa conversa do Hermes, ou reinicie-o.

**Como confirmar:** pergunte ao Jarvis "quais são minhas prioridades desta semana?". A resposta deve listar exatamente as tarefas marcadas com ⭐ no painel. Crie uma tarefa pelo Telegram e veja-a aparecer no painel com origem "jarvis" no histórico.

**Recomendação para começar:** defina `JARVIS_READONLY=true` no `.env` na primeira semana. O Jarvis só consulta; quando confiar no comportamento, mude para `false`.

### 3.4 Ferramentas disponíveis para a IA

| Ferramenta | Grava? | Função |
|---|---|---|
| `painel_semana` | não | Semana, prioridades, atrasos, XP, áreas, hábitos |
| `listar_tarefas` | não | Procurar tarefas (por texto, área, datas) |
| `ver_tarefa` | não | Detalhes, subdivisões, histórico e XP |
| `interpretar_data` | não | "quinta" → data exata; avisa quando é ambíguo |
| `listar_areas` | não | Áreas cadastradas |
| `revisao_semanal` | não | Dados reais para a síntese da semana |
| `contexto_projeto` | não | Projeto no painel + notas relacionadas |
| `notas_buscar` / `notas_recentes` / `notas_ler` | não | Memória do Obsidian |
| `criar_tarefa` | sim | Nova tarefa (validada) |
| `concluir_tarefa` | sim | Exige id; pede confirmação se houver subdivisões |
| `reabrir_tarefa` | sim | Desfaz conclusão com estorno explícito de XP |
| `dividir_tarefa` | sim | Quebra em passos menores |
| `notas_criar` / `notas_acrescentar` / `notas_relacionar` | sim | Escrita no vault (sem apagar nada) |

O servidor também envia ao Hermes instruções de comportamento: não inventar dados, perguntar quando a data ou a tarefa for ambígua, buscar notas antes de criar, confirmar o que foi feito.

### 3.5 Custos e privacidade do modelo de IA

O Hermes é gratuito, mas **o modelo de IA não necessariamente é**. Opções:

| Opção | Custo | Prós | Contras |
|---|---|---|---|
| API paga por uso (Anthropic, OpenAI, OpenRouter…) | Paga por mensagem; uso pessoal leve costuma ficar baixo, mas confira o preço do modelo | Melhor qualidade no uso de ferramentas | Exige cartão; **defina um limite de gastos** no painel do provedor |
| Modelos gratuitos de agregadores (ex.: variantes `:free` do OpenRouter) | Zero | Sem cartão | Limites de uso; qualidade variável; alguns provedores gratuitos podem registrar as conversas |
| Modelo local (Ollama ou similar, como "endpoint próprio") | Zero | Dados não saem do computador | Exige máquina com boa memória (8–16 GB+); num notebook antigo tende a ser lento e menos confiável com ferramentas |

**Privacidade:** com um modelo na nuvem, o texto das conversas **e o resultado das ferramentas** (suas tarefas, trechos de notas) são enviados ao provedor. Se isso for um problema para certos assuntos, use o modo básico ou um modelo local para eles.

Nenhuma dessas opções é exigida para o painel, o Obsidian ou o modo básico funcionarem.
