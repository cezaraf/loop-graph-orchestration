# LGO — Loop & Graph Orchestration

Framework local de referência para engenharia agêntica com **OpenSpec + grafos executáveis + loops verificados**. Implementação Python independente de modelo, fornecedor e harness, com CLI, persistência SQLite, contratos JSON Schema e demonstração Java/Spring + Angular/PrimeNG.

**OpenSpec define o comportamento; Graph agenda; Loop verifica e corrige; Gate controla autoridade; Learning propõe melhorias.**

Esta versão 0.1 funciona com agentes mock sem credenciais. Processos CLI e endpoints HTTP podem implementar o mesmo contrato de patches. Os wrappers específicos Codex/Claude/OpenCode e ACP estão no roadmap. Um endpoint de modelo OpenAI-compatible precisa de um harness de ferramentas para executar engenharia; ele não é tratado como agente de programação por si só.

## Começar

Ambiente validado: Linux/POSIX, Python 3.12, Node 24, OpenSpec **1.16.1**, Java 17. O pacote requer Python 3.11+ e o OpenSpec npm requer Node 22.12+. Outras plataformas ainda precisam de validação; o lock do scheduler utiliza `fcntl`.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock
pip install -e . --no-deps
npm ci --ignore-scripts
export LGO_OPENSPEC="$PWD/node_modules/.bin/openspec"
lgo --help
pytest -q
python scripts/eval.py
python scripts/demo.py --output ./demo-output
```

Use um diretório de saída novo a cada demonstração. A demo precisa de um JDK com o módulo `jdk.compiler`; Maven e downloads de dependências Java/Angular não são necessários para seus verificadores offline. A reprodução dos testes Spring completos e do build Angular exige Maven/npm e acesso aos respectivos registries.

A execução escreve `demo-output/demo-report.json`, checkpoints, evidências, Mermaid e um workspace integrado. Ela gera os arquivos da aplicação com mocks, executa três workers em paralelo, introduz HTTP 200 indevido, detecta o erro executando Java fora do agente, corrige para 404 e retoma sem repetir os resultados independentes. A suíte também mata um processo real com a execução em andamento e comprova a recuperação.

O grafo de demonstração verifica Java/contrato/estrutura de forma offline. Os testes Spring/MockMvc/H2 e o build Angular foram executados separadamente, inclusive sobre uma cópia dos arquivos integrados pelo LGO: [relatório](docs/report.md). Não se apresenta análise textual como teste de navegador.

## Usar em um projeto OpenSpec

Inicialize o OpenSpec com sua CLI oficial e crie proposta, design, specs e tasks pelo workflow oficial. O LGO acrescenta apenas `.lgo/`.

```bash
lgo --root /caminho/projeto --dry-run init
lgo --root /caminho/projeto init
lgo --root /caminho/projeto inspect minha-mudanca
lgo --root /caminho/projeto plan minha-mudanca --bindings .lgo/bindings/minha-mudanca.json
lgo --root /caminho/projeto validate-plan minha-mudanca
lgo --root /caminho/projeto graph minha-mudanca --format mermaid
lgo --root /caminho/projeto --dry-run run minha-mudanca
lgo --root /caminho/projeto run minha-mudanca
lgo --root /caminho/projeto status minha-mudanca
lgo --root /caminho/projeto resume run-ID
lgo --root /caminho/projeto verify run-ID
lgo --root /caminho/projeto report run-ID
lgo --root /caminho/projeto learn run-ID
lgo --root /caminho/projeto prepare-archive minha-mudanca
```

`--root`, `--json` e `--dry-run` são opções globais, antes do comando. Um caminho `--bindings` relativo é resolvido a partir do diretório de chamada; prefira absoluto quando usar `--root` externo.

Bindings revisáveis ligam tasks/requisitos reais a entradas, saídas, escopos e oracles. O planner deriva dependências pelo consumo dos artefatos declarados e valida as edges explícitas. Não determina semântica de dependências pelo nome ou pela ordem das tasks. Geração autônoma desses bindings a partir de linguagem natural ainda não está implementada.

Exemplo completo: [TipoExame](examples/tipo-exame/README.md), [bindings](examples/tipo-exame/.lgo/bindings/add-tipo-exame.json) e [templates](templates/README.md). O runtime de referência trabalha com saídas materializadas em arquivos; efeitos externos precisam de adapters com reconciliação própria.

## Autoridade e entrega

O merge automático ocorre dentro do workspace da execução. Alterar o checkout consumidor é uma etapa separada, protegida:

```bash
lgo --root /caminho/projeto export run-ID > patch-review.json
lgo --root /caminho/projeto integrate run-ID > approval-request.json
# Operador/serviço externo revisa e assina a decisão vinculada ao resultado.
lgo --root /caminho/projeto integrate run-ID --approval approved-token.json
lgo --root /caminho/projeto sync-progress minha-mudanca
lgo --root /caminho/projeto prepare-archive minha-mudanca --approval archive-token.json
```

Sem aprovação, `integrate` retorna a solicitação e código 3; não aplica o patch. Assinaturas usam chave de autoridade com permissão 0600 fora do projeto, configurada por `LGO_AUTHORITY_KEY_FILE`. [scripts/sign_approval.py](scripts/sign_approval.py) é um assinador interativo do operador. A chave não entra no contrato do worker. HMAC comprova posse da chave operadora, **não identidade/presença humana**. Produção requer serviço de aprovação protegido e ambiente isolado.

`sync-progress` só marca tasks cujas unidades passaram e cujas saídas correspondem ao checkout consumidor. O adapter usa IDs, caminhos e linhas oficiais, confere o hash da especificação e preserva o Markdown nativo. Checkboxes nunca substituem as evidências. `prepare-archive` exige qualidade, entrega e autoridade; prepara as operações oficiais sem executá-las. O LGO não implementa outro sincronizador de specs nem arquivador.

A demo não assina aprovações reais, não entrega automaticamente ao consumidor e não arquiva. O aprendizado fica PROPOSED; sua consequência em um plano futuro é mostrada como hipótese. Promoção/revogação com autoridade e duas execuções validadas são exercitadas pela suíte com chave exclusiva de teste.

## Estrutura

| Caminho | Conteúdo |
| --- | --- |
| `lgo/` | Planner, scheduler, workers/loops, adapters, verificadores, merge, gates, learning, state e CLI |
| `schemas/` | 16 contratos 2020-12 e pares de exemplos válidos/inválidos |
| `openspec/` | Especificação nativa da criação do LGO |
| `templates/` | Configuração operacional para projetos consumidores |
| `examples/tipo-exame/` | Aplicação, mudança OpenSpec, bindings e evidências de build/testes |
| `tests/` | Testes positivos, negativos, concorrência, recuperação e autoridade |
| `evals/` | Corpus determinístico de ataques e falhas controladas |
| `scripts/` | Demo, evals e assinatura externa de referência |
| `docs/` | Arquitetura, ADR, fontes, guias, relatório e matriz de aceite |

O núcleo depende apenas de `jsonschema` e `PyYAML`; SQLite, processos e concorrência usam a biblioteca padrão. LangGraph e Temporal foram avaliados e não são dependências obrigatórias.

## Documentação e limites

- [Arquitetura e comparação com OpenSpec nativo](docs/architecture.md)
- [Decisão tecnológica](docs/adr/001-runtime.md) e [pesquisa](docs/references/research.md)
- [Integração OpenSpec: versão, contratos e workflows reais](docs/references/openspec.md)
- [Máquina de estados](docs/state-machine.md), [recuperação](docs/recovery.md), [segurança](docs/security.md)
- [Instalação](docs/installation.md), [adapters](docs/adapters.md), [roadmap](docs/roadmap.md)
- [Relatório medido](docs/report.md) e [critérios de conclusão](docs/acceptance.md)

Os patches mock são delimitados pelo controlador. Processos CLI, comandos verificadores e endpoints HTTP são integrações confiáveis do operador; esta versão não oferece sandbox de SO ou isolamento de rede para código hostil. O histórico detecta corrupção por encadeamento de hashes, mas não resiste a um administrador capaz de reescrever banco e cadeia. Custos/tokens vêm de reports do adapter; mocks não medem consumo real de LLM.

A retomada automática foi exercitada para workers, checkpoints e integração de patches. Uma interrupção durante replanejamento/invalidação que deixe divergência de hashes deve bloquear e exigir reconciliação; recuperação automática de todas as operações de controle ainda é uma evolução. Não há garantia universal de exactly-once para ferramentas externas. ACP, MCP, OTLP, SSO e execução distribuída não estão implementados nesta versão.

Licença MIT. Projeto independente: https://github.com/cezaraf/loop-graph-orchestration. As referências originais permanecem preservadas.
