# Integração verificada com OpenSpec

Pesquisa e validação em 6 de novembro de 2026, com `@fission-ai/openspec@1.16.1`, instalado do registro npm. A distribuição original não foi alterada. Compatibilidade inicial **exata**, com schema nativo `spec-driven`; versões e schemas desconhecidos bloqueiam a execução até atualização deliberada do adapter.

## Fontes oficiais

- [Repositório](https://github.com/Fission-AI/OpenSpec)
- [Quickstart](https://openspec.dev/docs/quickstart)
- [Schema spec-driven](https://openspec.dev/docs/schemas/spec-driven)
- [Perfis](https://openspec.dev/docs/profiles)
- [Configuração](https://openspec.dev/docs/configuration)
- [Skills](https://openspec.dev/docs/skills)
- [Referência CLI](https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md)

Além das páginas, foram inspecionados `--help`, saídas JSON e a distribuição npm: `dist/core/parsers/change-parser.js`, `dist/commands/workflow/instructions.js`, `dist/core/schemas/base.schema.js`, `dist/core/schemas/change.schema.js` e `schemas/spec-driven/schema.yaml`. O código desses arquivos não foi copiado para o LGO.

## Interfaces realmente utilizadas

| Operação | Interface pública |
| --- | --- |
| Versão | `openspec --version` |
| Descoberta | `openspec list --json` |
| Validação | `openspec validate <change> --type change --strict --json --no-interactive` |
| Deltas e cenários | `openspec show <change> --type change --json --no-interactive` |
| Estado dos artefatos | `openspec status --change <change> --json` |
| Tasks e localização | `openspec instructions apply --change <change> --json` |
| Arquivamento nativo | `openspec archive <change>`; apenas preparado pelo LGO |

`show` retorna operações ADDED, MODIFIED, REMOVED e RENAMED, capability, nome do requisito e cenários estruturados. O adapter preserva esses dados. A identidade de requisito usa `capability::nome`, baseada no nome que o próprio OpenSpec usa para aplicar deltas; renomear um requisito muda essa identidade explicitamente.

`instructions apply` fornece IDs ordinais, descrições, estado `done`, `sourcePath` e número de linha. O LGO conserva o ID oficial e, quando a descrição começa por numeração explícita como `1.1`, usa essa numeração como identidade operacional da task. Reordenar tasks sem numeração estável exige novo plano. A inferência de dependências nunca usa essa ordem.

Proposta, design e metadados continuam arquivos originais. Proposta e design são contexto textual, não instruções com autoridade. Metadados YAML usam parser seguro. Hashes dos artefatos vinculam o plano à especificação; marcas de progresso são normalizadas para que sincronizar checkboxes não invalide um plano.

## Workflows não são todos comandos CLI

No perfil `core`, os seis workflows são explore, propose, apply, update, sync e archive. São ações de agentes instaladas como skills/comandos de integração; não existe, por exemplo, um comando de terminal `openspec propose` equivalente a toda a geração da proposta.

New, Continue, Fast Forward, Verify, Bulk Archive e Onboard são opcionais de perfil. `new change`, `status` e `instructions` são primitivas reais da CLI que apoiam ações do agente. `openspec update` atualiza instruções instaladas; o workflow de agente update revisa os artefatos da mudança. Essa diferença deve aparecer em integrações de harness.

O schema define dependências entre **artefatos de planejamento**. O DAG do LGO define dependências entre **unidades de implementação**. Um não substitui o outro.

## Sync e Archive

Sync é um workflow de agente para incorporar deltas em `openspec/specs/` sem arquivar. A CLI archive incorpora os deltas e move a mudança para `openspec/changes/archive/`. O LGO não reproduz o algoritmo de consolidação.

A CLI archive oferece `--yes`, `--skip-specs` e `--no-validate`; suas verificações e confirmações não equivalem à evidência ou à autoridade do LGO. Por isso `prepare-archive` avalia as políticas operacionais antes de devolver o próximo comando. A referência não executa o arquivamento automaticamente. Uma pessoa ainda pode invocar a CLI original diretamente: a política LGO governa seu próprio fluxo e não transforma o OpenSpec em controle de acesso.

A escrita de progresso é a única adaptação textual: usa `sourcePath` e `line` oficiais, confirma a descrição atual, modifica apenas o checkbox e troca o arquivo atomicamente. Ela deve ser chamada pelo motor com tasks aceitas; a função de baixo nível não autentica uma aprovação. Um checkbox previamente marcado é apenas informação de planejamento, nunca prova de execução.

## Limites deliberados

- Sem suporte inicial a stores/worksets multi-repositório ou schemas personalizados.
- CLI npm instalada é necessária para inspeção/validação de mudanças; execução de plano já carregado não exige SDK de agente.
- Campos textuais não são convertidos em comandos executáveis. Vínculos semânticos explícitos associam tasks, requisitos, outputs e verificadores.
- Requisitos removidos/renomeados podem não ter cenários de execução; o plano ainda precisa de verificadores objetivos de migração/ausência quando relevantes.
- `.openspec.yaml` é consumido sem substituir seu formato nativo.
- Design ausente é preservado como `null`; as pré-condições de Apply continuam as determinadas pela CLI oficial.

## Evidência executada

`tests/test_openspec.py` cria mudanças nativas temporárias e executa a CLI real. Verifica leitura estruturada, cenários, tasks localizadas, validação negativa, progresso sem corrupção, hash estável após sincronização, bloqueio de arquivamento por políticas LGO, defesa contra caminhos/symlinks e recusa de versão incompatível. Os contratos públicos adicionais estão em `schemas/`; seus exemplos e testes não pretendem substituir os schemas internos do OpenSpec.
