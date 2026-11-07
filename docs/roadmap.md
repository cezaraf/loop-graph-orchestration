# Evolução

A referência valida a composição OpenSpec + DAG + loops em instalação local. O relatório de aceite lista funcionalidades implementadas e bloqueadas. O roadmap abaixo não representa capacidades entregues.

| Prioridade | Evolução | Evidência exigida antes de declarar pronta |
| --- | --- | --- |
| Próxima | Sandbox de processos/containers e broker de ferramentas | Tentativas de exfiltração, escape de filesystem, segredo e política efetivamente negadas |
| Próxima | Adapter ACP com negociação explícita | Teste contra ao menos dois agentes e versões fixadas, incluindo cancelamento e permissões |
| Próxima | Wrappers CLI Codex/Claude Code/OpenCode | Contrato de patches, timeout de filhos e recuperação sem reutilizar credenciais indevidamente |
| Próxima | Autoridade de produção com identidade e presença humana | Evoluir HMAC operadora local para serviço protegido/SSO e decisão vinculada ao hash/run/ação, com expiração e revogação |
| Próxima | CI obrigatório para exemplo Java/Angular | Build real, contrato HTTP e teste de UI no mesmo commit integrado |
| Depois | OpenTelemetry e exportação OTLP | Spans correlacionados, tempos reais e ausência de segredos em atributos |
| Depois | Oracle assistido para novos projetos | Propostas revisáveis, cobertura de cenários e bloqueio quando não existe verificador |
| Depois | Migrações de schema/store | Compatibilidade e rollback testados de versões anteriores reais |
| Depois | Plugin de executor durável | Demonstração de necessidade multi-host; comparação entre Temporal, LangGraph e store próprio |
| Depois | Catálogo de aprendizado com regressões | Contradição, aplicabilidade, generalização, revogação e promoção auditada |

Nenhuma evolução de aprendizado deve modificar comportamento de produto fora do ciclo de mudança OpenSpec. Adoção em produção depende da fronteira de segurança real do ambiente, não do nome Autonomous Engineering.
