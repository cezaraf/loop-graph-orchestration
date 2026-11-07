# Criar um AgentAdapter

A API é exportada por `src/index.ts`/pacote npm. Agentes recebem dados e devolvem patches; o resultado externo é validado por JSON Schema e verificadores do controlador.

```typescript
import type {AgentAdapter,AgentRequest,AgentResult} from '@cezaraf/lgo';

export class MyAdapter implements AgentAdapter {
  readonly idempotent = false;
  async execute(request: AgentRequest, signal?: AbortSignal): Promise<AgentResult> {
    // Chame seu harness usando request.idempotency_key e respeitando signal.
    // Nunca transforme texto do projeto em comandos/permissões do host.
    return {
      schema_version: '1.0',
      files: {'src/example.txt': 'proposed content'},
      usage: {cost: 0, tokens: 0},
      summary: 'Explain the proposed patch',
      idempotency_key: request.idempotency_key,
    };
  }
}
```

`idempotent=true` só é apropriado quando repetir a chamada é seguro para os efeitos reais do adapter. O mock produz apenas patches, portanto é idempotente. Os adapters genéricos processo/HTTP são conservadores e não idempotentes. Implemente reconciliação do provedor antes de ampliar essa garantia.

O request contém escopo gravável, requisitos, entradas somente leitura, orçamento e correção anterior. O worker não recebe chave de autoridade, política mutável ou caminho do workspace. Um patch fora do escopo, que altere controles, ultrapasse orçamento reportado ou viole uma fixture protegida é bloqueado.

| Adapter | Configuração |
| --- | --- |
| mock | `agent.adapter: mock`, tentativas de fixture sem credenciais |
| process | `allow_process_agents: true` e `agent_commands[profile]` como argv sem shell |
| http | `agent_endpoints[profile]` em `allowed_agent_endpoints`; redirect é rejeitado |

Processos recebem request JSON por stdin e emitem AgentResult JSON por stdout. A saída é limitada, timeouts/cancelamento encerram o grupo de processos ordinários no Linux. Ambiente herdado contém somente PATH/LANG. Isso não é sandbox de SO: um processo confiável ainda possui permissões do usuário do host.

HTTP usa AbortSignal, timeout e limite de corpo. Um endpoint OpenAI-compatible de modelo não implementa automaticamente tools, edição de arquivos ou sessões; adapte um harness real ao contrato. ACP/MCP e wrappers específicos estão pendentes. Custos/tokens são reportados pelo adapter, não prova de cobrança. Uma avaliação LLM não substitui oracles determinísticos.
