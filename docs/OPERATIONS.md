# Operação

## Iniciar e parar

```
npm start        # abre o painel em http://localhost:4310
Ctrl+C           # encerra (fecha o banco com segurança)
```

Atalhos: `scripts/iniciar-windows.bat` (duplo clique; abre o navegador em `localhost:4310`) e `scripts/iniciar-mac.command`.

O painel só funciona enquanto o terminal estiver aberto. Se o computador dormir, o painel e o bot do Telegram ficam indisponíveis até ele acordar.

**Iniciar junto com o Windows (opcional):** pressione `Win+R`, digite `shell:startup`, e coloque nessa pasta um atalho para `scripts\iniciar-windows.bat`.

## Configuração (`.env`)

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `4310` | Porta do painel |
| `HOST` | `127.0.0.1` | `127.0.0.1` = só este computador; `0.0.0.0` = rede de casa (exige `ACCESS_TOKEN`) |
| `ACCESS_TOKEN` | vazio | Senha de acesso para uso pela rede |
| `TIMEZONE` | `America/Sao_Paulo` | Fuso para "hoje", semanas e prazos |
| `DATA_DIR` | `./data` | Onde fica o banco |
| `BACKUP_DIR` | `./backups` | Onde ficam os backups |
| `AUTO_BACKUP` / `BACKUP_KEEP` | `true` / `30` | Backup automático diário e quantos manter |
| `OBSIDIAN_VAULT_PATH` | vazio | Pasta do vault |
| `JARVIS_API_URL` | `http://127.0.0.1:PORT` | Para o servidor MCP achar o painel |
| `JARVIS_READONLY` | `false` | Jarvis só consulta |
| `JARVIS_TELEGRAM_BOT_TOKEN` / `JARVIS_TELEGRAM_ALLOWED_USERS` | vazio | Modo básico do Telegram |

Depois de mudar o `.env`, reinicie o painel. `npm run doctor` confere tudo.

## Acesso por outros dispositivos

Hoje, sem configuração extra, o painel funciona **apenas no computador onde roda**. Três níveis:

### 1. Local (padrão)
`http://localhost:4310` no próprio computador. Nada a configurar.

### 2. Rede de casa (Mac e iPhone no mesmo Wi-Fi)
1. Gere uma senha longa (ex.: 24+ caracteres aleatórios de um gerenciador de senhas).
2. No `.env`: `HOST=0.0.0.0` e `ACCESS_TOKEN=<a senha>`.
3. Reinicie. O terminal mostra o endereço, ex.: `http://192.168.0.15:4310`.
4. No Windows, se aparecer o aviso do Firewall, permita **apenas em redes privadas**.
5. No iPhone/Mac, abra esse endereço, informe a senha (fica salva só naquele navegador). No iPhone: Compartilhar → "Adicionar à Tela de Início" para abrir em tela cheia.

**Como confirmar:** o painel abre no iPhone e pede a senha; com a senha errada, não mostra dados.

**Limitação:** na rede local a conexão é HTTP (sem criptografia). Numa rede doméstica com Wi-Fi protegido é aceitável; **não use em Wi-Fi público**. O endereço IP do computador pode mudar; se isso acontecer, fixe o IP no roteador.

### 3. Fora de casa (não configurado)
Não abra portas no roteador. A opção mais simples e segura é o **Tailscale** (gratuito para uso pessoal): instale no computador e no iPhone, entre com a mesma conta, e acesse `http://<nome-do-computador>:4310` de qualquer lugar, com `HOST=0.0.0.0` e `ACCESS_TOKEN` definidos. Para o Jarvis pelo Telegram, isso não é necessário: o Telegram já funciona fora de casa porque o bot é que busca as mensagens.

## Backup

### O que é protegido
- **Banco do painel** (tarefas, hábitos, XP, revisões): `npm run backup`.
- **Vault do Obsidian**: `npm run backup:vault` faz uma cópia completa da pasta. Também é uma boa ideia manter o vault numa pasta sincronizada (OneDrive, Google Drive, iCloud) ou num repositório Git privado.

### Automático
Com o painel aberto, um backup `lifedash-auto-*.db` é criado por dia (no máximo um a cada ~20 h), mantendo os últimos `BACKUP_KEEP`. Backups manuais e de segurança nunca são apagados automaticamente.

### Manual
```
npm run backup            # cria backups/lifedash-manual-AAAA-MM-DD_HHMMSS.db (+ .json com contagens)
npm run backups           # lista
```
Pela tela: **Ajustes → Backup → Fazer backup agora**. Pode ser feito com o painel aberto (o backup tira uma "foto" consistente do banco).

Cada backup é verificado ao ser criado (integridade do SQLite, versão, contagens, XP total).

**Recomendação forte:** aponte `BACKUP_DIR` para uma pasta sincronizada com a nuvem. Backup no mesmo disco não protege contra perda ou roubo do computador.

## Restauração

1. **Feche o painel** (`Ctrl+C`). A restauração é recusada se ele estiver aberto.
2. Escolha o arquivo: `npm run backups`.
3. Restaure:
   ```
   npm run restore -- lifedash-manual-2026-10-24_175207.db
   ```
   O programa mostra o que há no backup e pede para digitar `RESTAURAR`.
4. Antes de substituir, o banco atual é salvo como `lifedash-pre-restore-*.db` — então a própria restauração pode ser desfeita restaurando esse arquivo.
5. Abra o painel e confira.

Verificar um backup sem restaurar: `node src/backup/cli.js verify backups/<arquivo>.db`.

Essa sequência é testada automaticamente (`tests/backup.test.js`): cria dados, faz backup, altera, restaura e confere que tarefas e XP voltaram exatamente ao estado do backup.

**Restaurar o vault:** copie a pasta `backups/vault-*` de volta para o lugar do vault (com o Obsidian fechado). Para uma nota só, use `<vault>/.jarvis/historico/`.

## Manutenção

- **Atualizar o projeto:** `git pull` e reinicie. Migrações do banco rodam sozinhas ao iniciar. Faça um backup antes.
- **Testes:** `npm test` (unitários e integração). Teste de interface opcional: `node tests/e2e/ui-smoke.mjs` (requer Playwright).
- **"O painel já parece estar aberto"** mas não está (ex.: o computador desligou de repente): apague o arquivo `data/server.pid` e inicie de novo.
- **"A porta 4310 já está em uso":** feche o outro painel aberto ou mude `PORT`.
- **Mover para outro computador:** copie `data/lifedash.db` (com o painel fechado) ou restaure um backup lá; copie o `.env` e ajuste os caminhos.
