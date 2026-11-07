# Arquivos para projetos consumidores

`lgo init` cria apenas `.lgo/config.yaml` ausente. O config de exemplo é uma base revisável, não uma allowlist universal. Escolha comandos que você controla e teste casos negativos.

Bindings ficam em `.lgo/bindings/<change>.json`. Um binding é configuração operacional: mapeia IDs reais retornados por `lgo inspect` para escopo, artefatos de entrada/saída, oracles e agente. Não substitui proposta/specs/design/tasks OpenSpec.

Use `examples/tipo-exame/.lgo/bindings/add-tipo-exame.json` como exemplo completo. O planner deriva edges pelo consumo de artefatos e mantém justificativas declaradas. Escritas concorrentes precisam de dependência ou recurso comum. Neste runtime de patches, outputs são arquivos verificáveis.

Apenas unidades com critérios externos executáveis podem iniciar. `file_contains` é suficiente para testar uma fronteira simples, mas não prova semântica de uma aplicação. Para aplicações reais configure build/testes/contrato com comandos confiáveis e fixtures protegidas.
