# Instalação e adoção progressiva

Instale a partir da raiz do projeto distribuído, em ambiente Python isolado:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
lgo --help
pytest -q
```

Consulte `pyproject.toml` para a versão mínima de Python e extras efetivamente disponibilizados. A referência usa locks `fcntl` e gerenciamento POSIX de grupos de processos: o alvo suportado nesta entrega é Linux/POSIX. Windows nativo exige um port desses mecanismos; WSL é a opção de adoção inicial. macOS precisa de execução própria da suíte antes de declarar compatibilidade.

O OpenSpec é instalado separadamente, em sua versão suportada. O adapter valida a versão encontrada; confira [a integração testada](references/openspec.md). `openspec init --tools none` inicializa os artefatos sem instalar integrações de harness. Use uma integração oficial escolhida pelo usuário quando desejada.

## Projeto novo

1. Inicialize OpenSpec usando sua CLI oficial.
2. Explore/proponha uma mudança pelo workflow oficial, produzindo proposal, specs, design e tasks.
3. Execute `lgo init` para acrescentar configuração operacional.
4. Defina bindings explícitos de tasks/requisitos para unidades, entradas/saídas, escopos e verificadores.
5. Inspecione, planeje e valide antes de executar.

```bash
lgo inspect minha-mudanca
lgo plan minha-mudanca
lgo validate-plan minha-mudanca
lgo graph minha-mudanca
lgo run minha-mudanca
lgo status minha-mudanca
lgo prepare-archive minha-mudanca
```

Use as opções `--help`, JSON e dry-run indicadas na CLI da versão instalada. Um dry-run de planejamento não é evidência de que build e testes funcionam.

## Projeto existente

Crie commit/backup antes do bootstrap. LGO deve criar somente sua configuração ausente e não substituir `openspec/config.yaml`. Primeiro inspecione mudanças reais e configure verificadores que o projeto já utiliza. Não marque todas as tasks como concluídas para facilitar archive.

| Nível | Configuração necessária | Adoção |
| --- | --- | --- |
| 1 — Loop | Uma unidade, escopo restrito e oracle determinístico | Produzir/verificar/corrigir localmente |
| 2 — Graph | Bindings, dependências e recursos de várias unidades | Paralelismo e integração com conflitos explícitos |
| 3 — Autonomous Engineering | Persistência preservada, política de risco e autoridade externa | Recuperação, CI, métricas e aprendizado controlado |

Não é necessário adotar orquestração distribuída para começar no nível 1. O mock funciona sem conta ou chave de LLM.

## Atualização e remoção

Atualize em branch, preserve configuração existente e execute a suíte com a versão fixada de OpenSpec. Contratos de versão major desconhecida devem ser rejeitados; migrações de store/plano exigem backup e validação. A referência não oferece um migrador universal de bancos futuros.

Para remover, encerre execuções, exporte evidências desejadas, desinstale o pacote Python e remova somente arquivos criados pelo LGO que você confirmou serem dispensáveis. Preserve `openspec/` e código da aplicação. Não execute uma limpeza recursiva genérica em projeto consumidor. Retenção/remoção de execuções são decisões do operador; não existe promessa de desinstalação transacional de sistemas externos.
