# Scripts de Demonstração

Esta pasta contém scripts de demonstração para testar as funcionalidades de inspeção HTTP do localtunnel-client.

## Scripts Disponíveis

### test-debug.js

Demonstra a funcionalidade de inspeção HTTP com diferentes tipos de conteúdo.

**Uso:**
```bash
node scripts/test-debug.js
```

**Testa:**
- Requisições JSON (POST)
- Respostas XML
- Respostas de texto
- Respostas binárias (imagens)
- JSON grande (formatado)
- GET requests sem body

### test-preview-size.js

Demonstra a configuração do tamanho do preview usando a variável de ambiente `LT_INSPECT_BODY_PREVIEW_SIZE`.

**Uso:**
```bash
node scripts/test-preview-size.js
```

**Testa:**
- Preview de texto com limite de 50 bytes
- Preview de XML com limite de 50 bytes
- Truncamento de conteúdo grande

## Como Usar com o Localtunnel

Para ver a inspeção em ação com um túnel real:

```bash
# Inspecionar apenas requests
DEBUG=localtunnel:inspect:request lt --port 3000

# Inspecionar apenas responses
DEBUG=localtunnel:inspect:response lt --port 3000

# Inspecionar ambos
DEBUG=localtunnel:inspect:* lt --port 3000

# Configurar tamanho do preview
LT_INSPECT_BODY_PREVIEW_SIZE=1000 DEBUG=localtunnel:inspect:* lt --port 3000
```

## Mais Informações

Consulte [DEBUG_INSPECTION.md](DEBUG_INSPECTION.md) para documentação completa sobre a funcionalidade de inspeção HTTP.
