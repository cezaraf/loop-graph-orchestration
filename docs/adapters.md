# Criar um adapter

Um adapter conecta uma unidade ao executor de agente. O contrato JSON é a fronteira portátil; fornecedor, modelo e linguagem do projeto não pertencem ao scheduler. Consulte `lgo/adapters.py` e `schemas/` para as assinaturas exatas da versão instalada.

## Entrada e saída

O request contém identidade da execução/unidade, objetivo, contexto autorizado, requisitos, escopo, orçamento, timeout e feedback da última reprovação. O resultado devolve alterações estruturadas, metadados de uso quando disponíveis e descrição da tentativa. O controlador decide se o patch é permitido e verifica seu efeito.

O adapter deve devolver arquivos/patches; não deve marcar a unidade como PASSED, escolher o gate, atualizar políticas ou gravar checkboxes. Resultados inválidos falham na fronteira do contrato. Evite transportar segredos no request, resultado ou eventos.

## Implementação

1. Implemente a interface `AgentAdapter` seguindo o adapter mock incluído.
2. Traduza somente o contexto permitido para o executor.
3. Propague timeout e cancelamento. Termine grupo de processos se o executor cria filhos.
4. Valide a resposta antes de produzir `AgentResult`.
5. Registre tokens/custo somente quando fornecidos ou calculáveis; informe ausente quando desconhecido.
6. Passe testes de contrato, timeout, escopo, resultado malformado, cancelamento e correção com feedback.

Não execute comandos devolvidos pelo LLM. O operador configura previamente os comandos verificadores. O adapter é código confiável; uma implementação maliciosa no mesmo processo pode burlar qualquer checagem em Python.

## Mecanismos de conexão

| Executor | Integração possível | O que ainda precisa ser garantido |
| --- | --- | --- |
| Mock | Respostas/patches determinísticos por tentativa | Simula uso do agente; não mede qualidade de LLM |
| Processo CLI | JSON stdin/stdout ou protocolo do harness, argumentos explícitos e sem shell | Sandboxing, cancelamento de filhos, saída limitada e autenticação externa |
| HTTP de agente | Serviço retorna patch com contrato estruturado | TLS/autenticação, host permitido, limite de resposta, timeout e idempotência |
| API OpenAI-compatible | Modelo produz conteúdo estruturado | Tool runtime, edição e sessão devem ser implementados; endpoint de chat não equivale a harness |
| ACP | Sessões e turnos pelo protocolo negociado | Capacidades, permissões, filesystem, cancelamento e versão suportada |
| Claude Code, Codex, OpenCode | Wrapper CLI ou ACP quando o executor suportar | Não pressupor nomes de flags ou compatibilidade sem teste da versão específica |
| MCP | Broker de ferramentas/contexto para o executor | MCP não é scheduler; servidor e ferramentas precisam de autorização própria |

Essas rotas documentam extensão. A lista de adapters realmente implementados e exercitados consta do README/relatório. Uma rota não verificada deve continuar identificada como pendente.

## Teste de conformidade

Use uma unidade com arquivo exclusivo, uma segunda tentativa que recebe `CorrectionRequest`, um patch que tenta `../`, uma resposta acima do orçamento e um cancelamento. Comprove que o adapter não pode fabricar `VerificationResult` aceito pelo controlador. Para efeitos externos não idempotentes, reproduza interrupção após efeito e antes de resposta; a recuperação deve reconciliar ou bloquear, sem duplicar o efeito.
