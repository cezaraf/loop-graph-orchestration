## Context
Exemplo executável local independente de fornecedores LLM; dados efêmeros em H2.
## Goals / Non-Goals
Demonstrar CRUD e orquestração verificável. Não disponibilizar um sistema clínico em produção.
## Decisions
Contrato OpenAPI versionado antes da integração. Backend, frontend e verificações de contrato podem ser produzidos simultaneamente a partir do design estável. Um nó de integração consome os três. Código NotFoundPolicy compartilhado entre o advice e um oráculo javac offline: apenas o backend falha e corrige o 404. O teste offline não substitui MockMvc/Maven nem browser E2E.
## Risks / Trade-offs
Sem autenticação: bind loopback obrigatório, nenhuma operação de produção autorizada. O H2 perde os dados após o processo terminar.
## Migration Plan
Nenhuma migração. Remover diretório do exemplo para desinstalar.
## Open Questions
E2E com browser deve ser executado no ambiente de adoção.
