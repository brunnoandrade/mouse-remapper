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

## Fase 4: diferenciais ✅

- ✅ Gestos: segurar um botão e arrastar (4 direções, 60 px); o clique simples do botão passa a disparar ao soltar
- ✅ Ajustes de scroll da roda do mouse: inverter direção, velocidade e aceleração (trackpad intocado)
- ✅ Suavização do scroll (a roda vira uma animação ease-out a 120 Hz; distância conservada, inverter/velocidade/aceleração continuam valendo). Falta só afinar a sensação no seu mouse
- ✅ Exportar e importar configuração (o arquivo importado é validado; a aparência não é importada)

## Windows

O app Electron já é multiplataforma; o que muda é o helper nativo (no macOS, Swift + event tap; no Windows, Go + hook `WH_MOUSE_LL` + `SendInput`). Ele fica em `native/windows/` e lê o mesmo `config.json`.

- ✅ Helper em Go com a lógica portável testada no Mac (host falso): perfis, gestos, scroll (ajustes e suavização), mapa de teclas macOS→Windows (checado contra a lista de teclas da interface), planejamento de ações, armazenamento da config com as mesmas garantias do macOS
- ✅ Camada Win32 fina (hook, `SendInput`, app em foco, listar apps) compilando para amd64 e arm64
- ✅ Electron por plataforma (`src/platform.js`): pasta da config (`%AppData%`), nome/local do helper, ícone de bandeja, menu, item de login (argumento `--hidden`), sem card de permissão, ícones dos apps via `app.getFileIcon`
- ✅ Interface por plataforma: modificadores Ctrl/Alt/Shift/Win, catálogo de ações do Windows (Visão de tarefas, áreas de trabalho virtuais, Win+Shift+S), sem botões extras 5+
- ✅ Testes que rodam num runner Windows (`.github/workflows/windows-helper.yml`): existência de cada API do Win32, layout das estruturas de `SendInput`, e o hook real com eventos injetados
- ✅ Validado num runner Windows (GitHub Actions): 40 testes, incluindo o hook real com eventos injetados (botão lateral engolido, gesto, inverter/velocidade, suavização). A primeira execução achou dois bugs reais, já corrigidos: `SendInput` dentro do callback do hook não era entregue, e a data de modificação do arquivo é grossa demais para detectar reescritas
- ⬜ **Testar no Windows com um mouse de verdade** (o CI injeta eventos sintéticos): botão lateral, gestos, sensação da suavização, e a interface do Electron rodando no Windows
- ⬜ Empacotamento e assinatura para Windows (junto com a Fase 5)

Limitações conhecidas no Windows:
- Apps abertos como administrador não recebem os remapeamentos, a menos que o Mouse Remapper também rode como administrador (limite do hook)
- Touchpads de precisão e mouses de alta resolução (deltas menores que uma "trava" da roda) não têm o scroll alterado
- A roda só é ajustada em múltiplos de 120; botões extras além dos dois laterais não existem no hook padrão
- O nome do app na lista é o do executável (ex.: "Chrome"), e o perfil é identificado pelo nome do `.exe`
- O ⌘ da configuração vira a tecla Windows; configs exportadas do Mac usam teclas de atalho do Mac

## Fase 5: distribuição

- ✅ Empacotamento: macOS (`.app`, `.dmg`, `.zip`, arm64) e Windows (instalador NSIS e `.zip`, x64), com `npm run dist` e `npm run verify-package`
- ✅ Pacote testado de verdade (`.github/workflows/package.yml`): no macOS o app empacotado abre e o helper responde; no Windows o instalador é executado em silêncio, o app instalado abre e inicia o helper, e o desinstalador roda
- ⬜ Assinatura de distribuição: Developer ID + notarização (Mac) e certificado de código (Windows). Hoje o build do Mac é assinado com a sua identidade de desenvolvimento (vale só nesta máquina) e o do Windows não é assinado (SmartScreen avisa na primeira vez)
- ⬜ Atualização automática (`electron-updater`), que exige um lugar para publicar as versões (por exemplo, GitHub Releases)
- ⬜ Mac Intel e Windows arm64 (hoje: Mac Apple Silicon e Windows x64)
- ⬜ Interface em inglês (i18n), se o público for além de uso pessoal

## Em aberto

- Público-alvo: uso pessoal ou distribuição? Define a prioridade da Fase 5.
- Modelo de config: a migração da Fase 2 precisa manter configs antigas funcionando.
