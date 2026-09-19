# Roadmap

Direção do Mouse Remapper, com base no que apps similares (Mac Mouse Fix, LinearMouse, SteerMouse, BetterMouse, Karabiner-Elements) oferecem.

Legenda: ✅ feito · 🚧 em andamento · ⬜ pendente

## Estado atual

- ✅ Scroll para cima/baixo e clique do meio remapeados para teclas (com modificadores)
- ✅ Remapeamento restrito a uma lista de apps
- ✅ Sensibilidade do scroll e bloqueio dos eventos originais
- ✅ Ícone na bandeja
- ✅ Tema Sistema / Claro / Escuro

## Fase 1: base sólida

- ⬜ Detectar a permissão de Acessibilidade e mostrar o status real (`AXIsProcessTrusted` no helper)
- ⬜ Iniciar no login (`app.setLoginItemSettings`, com toggle nas configurações)
- ⬜ Salvar automaticamente, no lugar do botão Salvar
- ⬜ "Restaurar padrões" e validação de conflitos entre mapeamentos

## Fase 2: mais gatilhos e ações

- ⬜ Suporte aos botões laterais (4/5) e a outros botões extras no event tap
- ⬜ Modelo de ação genérico `{ type: 'key' | 'system' | 'app' | 'click', ... }` no lugar de `keyCode + flags`, com migração do config existente
- ⬜ Catálogo de ações de sistema: Mission Control, Spaces, Launchpad, mídia, volume, screenshot

## Fase 3: perfis por app

- ⬜ Config no formato `{ default, perApp: { bundleId: mapeamentos } }`
- ⬜ UI com seletor de app no topo e mapeamentos abaixo (reaproveitando o seletor de apps atual)
- ⬜ A lista "aplicar apenas nestes aplicativos" passa a ser "apps com perfil próprio"

## Fase 4: diferenciais

- ⬜ Gestos: segurar um botão e arrastar
- ⬜ Ajustes de scroll: suavização, inversão e aceleração
- ⬜ Exportar e importar configuração

## Fase 5: distribuição

- ⬜ Assinatura (Developer ID) e notarização
- ⬜ DMG e atualização automática (`electron-updater`)
- ⬜ Interface em inglês (i18n), se o público for além de uso pessoal

## Em aberto

- Público-alvo: uso pessoal ou distribuição? Define a prioridade da Fase 5.
- Modelo de config: a migração da Fase 2 precisa manter configs antigas funcionando.
