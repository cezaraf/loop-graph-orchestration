# Suíte TypeScript de compatibilidade e regressão

`npm ci --ignore-scripts && npm test` compila o runtime e executa `node --test tests/*.test.ts`. `npm run typecheck` verifica também os tipos dos testes. Não há pytest ou Python no procedimento. OpenSpec1.16.1 é instalado como devDependency; os testes de integração falham se a CLI faltar, sem converter SKIP em PASS.

| Cenários preservados/ampliados | Arquivo |
| --- | --- |
|16 contratos, exemplos válidos/inválidos e versão desconhecida | `contracts.test.ts` |
| Rastreabilidade, produtores, edges, ciclos, conflitos, recursos, paralelismo, loops, limites, no-progress, recovery/SIGKILL, merge, replan, learning e entrega | `engine.test.ts` |
| Aprovação falsa, binding/expiração/ator, segredo, scope escape, binário, budgets, remote refs, YAML ambíguo, symlinks e preflight de invalidação | `security.test.ts` |
| Processo/HTTP reais de fixture, stdout limitado, redirects, cancelamento e grupos de processos | `adapters.test.ts` |
| CLI, bootstrap/dry-run, OpenSpec, sincronização e archive bloqueado | `cli.test.ts` |
| CLI oficial, ADDED/MODIFIED/REMOVED/RENAMED, hashes e checkbox seguro | `openspec.test.ts` |
| Checkpoint Python real, backup, retomada, fonte/histórico/saída adulterados e versão desconhecida | `migration.test.ts` |

A fixture legada foi produzida pelo código Python0.1 publicado no commit949ce3b. Ela contém bytes originais dos eventos, manifest e arquivos do workspace. O teste remapeia apenas o caminho local do workspace antes de montar o banco legado, então exige preservação das tentativas de PASSED e retomada do consumidor. A fixture é estática: não chama Python em CI.

`node scripts/eval.mjs` executa os oito casos determinísticos existentes. `node scripts/demo.mjs --output NOVO_DIRETORIO` exercita o exemplo real OpenSpec + Java policy + grafo concorrente. Spring/H2/MockMvc e Angular são verificações separadas identificadas no relatório. Tokens/chaves de aprovação de fixture não representam autorização humana real.
