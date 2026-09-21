# Roadmap

Direção do Mouse Remapper, com base no que apps similares (Mac Mouse Fix, LinearMouse, SteerMouse, BetterMouse, Karabiner-Elements) oferecem.

Legenda: ✅ feito · 🚧 em andamento · ⬜ pendente

## Estado atual

- ✅ Scroll para cima/baixo e clique do meio remapeados para teclas (com modificadores)
- ✅ Remapeamento restrito a uma lista de apps
- ✅ Sensibilidade do scroll e bloqueio dos eventos originais
- ✅ Ícone na bandeja
- ✅ Tema Sistema / Claro / Escuro
- ✅ Lista genérica de regras "gatilho → ação" (tecla, ação de sistema, clique ou abrir app), com editor

## Fase 1: base sólida ✅

- ✅ Detectar a permissão de Acessibilidade e mostrar o status real (`--check-permission` no helper); o helper reinicia sozinho quando a permissão é concedida
- ✅ Iniciar no login (`app.setLoginItemSettings`, com toggle nas configurações; só no app empacotado, sobe direto na bandeja)
- ✅ Salvar automaticamente, no lugar do botão Salvar
- ✅ Validação de conflitos: um gatilho não pode ter duas regras
- ✅ "Restaurar padrões" (mapeamentos e sensibilidade; mantém apps e aparência)

## Fase 2: mais gatilhos e ações ✅

- ✅ Botões laterais (voltar/avançar) no event tap
- ✅ Botões extras (5+), por seleção ou detecção do botão
- ✅ Modelo de ação genérico `{ type: 'key' | 'system' | 'app' | 'click', ... }` no lugar de `keyCode + flags`, com migração do config existente
- ✅ Catálogo de ações de sistema: Mission Control, Spaces, mídia, volume, screenshot (Launchpad fica de fora: removido no macOS 26)

## Fase 3: perfis por app ✅

- ✅ Config no formato `{ defaultProfile, appProfiles: { bundleId: { mappings } } }`, com migração que preserva o comportamento atual
- ✅ Lista de perfis na barra lateral (Global + apps); a lista de regras mostra o perfil selecionado
- ✅ A lista "aplicar apenas nestes aplicativos" virou "apps com perfil próprio"; a regra do app sobrepõe a global só para o mesmo gatilho
- ✅ Ação "Comportamento original" para um app ignorar uma regra global

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
