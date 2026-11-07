# Instalação e adoção

LGO0.2 usa TypeScript compilado/Node24.22.1. Instale Node/npm, então execute na raiz do repositório:

```bash
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
npm pack
npm install -g ./cezaraf-lgo-0.2.0.tgz
lgo --help
```

O pacote instalado possui apenas Ajv e yaml como dependências de produção. SQLite vem de `node:sqlite`. A operação e os testes não exigem Python ou compilação de addon. Java17/JDK é necessário para a demo; Maven/npm para verificar a aplicação Spring/Angular completa.

OpenSpec1.16.1 é instalado separadamente para o consumidor, ou acessado pelo devDependency desta fonte via `LGO_OPENSPEC`. Inicialize/configure OpenSpec pelos comandos oficiais. `lgo init` preserva arquivos existentes e só cria a configuração ausente. Primeiro use `--dry-run`.

| Nível | Adoção |
| --- | --- |
| Loop | Uma unidade, escopo restrito e oracle externo |
| Graph | Várias unidades, artefatos, dependências e recursos explícitos |
| Autonomous Engineering local | Persistência, gates, recuperação, métricas e aprendizado controlado |

Não é necessário cluster/servidor de banco. Para migrar estados0.1, siga [recovery.md](recovery.md). O schema operacional SQLite passa a2; os contratos de mensagens permanecem1.0. Outras migrações futuras não são presumidas compatíveis.

Atualize em branch e rode a suíte. Para remover, pare os controladores, preserve/exporte evidências e desinstale o pacote npm; remova apenas arquivos LGO revisados. Preserve `openspec/` e código da aplicação. Retenção recomendada de30dias é orientação de operação, sem coleta automática.
