# ADR002 — Migrar o runtime para TypeScript/Node.js

Status: aceito para0.2. Substitui a decisão de implementação Python do ADR001. A decisão de compor o OpenSpec e manter execução local permanece.

A missão do LGO exige principalmente coordenação de I/O, processos, contratos e protocolos de agentes. TypeScript facilita contratos públicos tipados e distribuição npm; a linguagem da aplicação e o harness continuam independentes.

Escolhemos TypeScript strict, ESM, Node24.22.1 e SQLite nativo `node:sqlite`. O pacote operacional depende de Ajv2020 e yaml. O compilador TypeScript, OpenSpec CLI, tipos Node e Prettier são ferramentas de desenvolvimento. A CLI é compilada e o pacote instalado não precisa do compilador nem de Python. O npm package não foi publicado no registry; `npm pack` gera um artefato instalável.

| Alternativa | Avaliação nesta migração |
| --- | --- |
| TypeScript/Node | Escolhida: tipos, ecossistema de protocolos e distribuição npm, com cancelamento por AbortSignal |
| Go | Ótima opção para binário único; adicionaria outra cadeia de implementação e contratos neste produto |
| Java | Adequada a serviço empresarial centralizado; o foco atual é uma CLI local portátil |
| Manter Python | Continuava viável para o protótipo; o usuário escolheu priorizar TypeScript e suas integrações |

O Node24.22.1 fornecido pelo ambiente foi verificado e é a versão fixada para CI. Não se presume compatibilidade automaticamente com outros majors. SQLite nativo evita `better-sqlite3` e eventual compilação via node-gyp/Python. A API síncrona mantém transações curtas e não bloqueia chamadas de agentes, que permanecem assíncronas. Concorrência de CPU pesada continua delegada a processos externos.

O lock de execução normal passa a ser lease SQLite com PID/nonce, adquirido em transação imediata. Após SIGKILL, PID morto permite retomada; PID vivo ou reutilizado bloqueia conservadoramente. Na migração legada, `flock` é necessário apenas quando existe o arquivo do antigo controlador, para interoperar com `fcntl`. Essa ferramenta de SO não é requerida para novas execuções.

Wire contracts permanecem1.0. O formato operacional SQLite usa `user_version=2`. A migração é explícita, valida evidências, cria backup consistente e preserva unidades PASSED. Gates e integração são revalidados; bindings HMAC possuem domínio de runtime novo. A fixture de compatibilidade foi capturada executando o código Python0.1 real, e os testes TypeScript a consomem sem chamar Python.

Referências: [node:sqlite](https://nodejs.org/api/sqlite.html), [child_process](https://nodejs.org/api/child_process.html), [Ajv2020](https://ajv.js.org/json-schema.html), [OpenSpec](https://github.com/Fission-AI/OpenSpec).
