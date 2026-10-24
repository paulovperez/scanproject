# Intraoral Scanner Challenge

Jogo web mobile para apresentação comercial de scanner intraoral. O participante lê um QR Code, abre o jogo no navegador do celular, configura o paciente e tenta escanear as arcadas superior e inferior e a mordida dos dois lados em menos de 190 segundos.

- 100% estático: HTML, CSS e JavaScript puro, **sem dependências, sem backend, sem chaves de API**.
- 3D real com um renderizador WebGL próprio (~17 KB) e um módulo de visibilidade por raycasting (~11 KB), sem bibliotecas como three.js. Peso total ≈ 180 KB. Nenhuma requisição externa (nem fontes): depois de carregada, a partida não depende de internet.
- Não usa câmera, não pede permissões, não coleta dados. O único dado salvo é o **recorde pessoal**, no `localStorage` do próprio aparelho. A configuração do paciente fica só na memória da sessão.

## Estrutura

```
intraoral-scanner-challenge/
├── index.html        Telas: início, configuração do paciente, partida e resultado
├── css/styles.css    Identidade visual (branco, laranja, cinzas)
├── js/strings.js     TODOS os textos da interface (tradução em um só lugar)
├── js/arch.js        Geometria das arcadas adulta e infantil (em mm), anatomia das coroas, gengiva com
│                     papilas, pontos de escaneamento por face e a ilustração 2D da tela inicial
├── js/capture.js     Visibilidade do scanner: campo de captura, distância, ângulo, oclusão (raycasting)
├── js/gl.js          Renderizador WebGL: câmera orbital, zoom, materiais, malha digital, mapa de qualidade
├── js/app.js         Fluxo do jogo, configuração, gestos, cronômetro, progresso por face, qualidade, recorde
└── assets/icon.svg   Ícone da aba
```

## Como o jogo funciona

- **Idioma:** seletor no topo da tela inicial — **PT** (português do Brasil), **EN** (English), **FR** (français), **ES** (español). Toda a interface muda na hora. Na primeira abertura o jogo usa o idioma do celular (pt/fr/es; qualquer outro → inglês). A escolha fica no endereço (`?lang=pt-BR`, `en`, `fr`, `es`), não no armazenamento do aparelho; assim dá para gerar um QR Code já em um idioma, por exemplo `https://SEU-ENDERECO/?lang=pt-BR`.
- **Início:** "START SCANNING" abre a **configuração do paciente** (Patient setup):
  - **Patient type:** *Adult Patient* (28 dentes permanentes, 5 regiões por arcada) ou *Pediatric Patient* (20 dentes decíduos, arcada menor e mais arredondada, com diastemas, 3 regiões por arcada).
  - **Tooth shade:** Natural white, Bright white, Ivory, Natural yellow. É só visual: não altera a pontuação nem a qualidade.
  - **Teeth:** visualizador 3D (arraste para girar, pinça ou botões para zoom, botão de centralizar). Toque em um dente (numeração FDI, ex.: "Tooth 16 · Upper right · First molar") e use *Remove tooth* / *Restore tooth*; *Restore all teeth* volta à dentição completa. O dente removido deixa o espaço com a gengiva cicatrizada. É obrigatório manter ao menos um dente posterior de cada lado em cada arcada, porque ele é necessário para a mordida. A anatomia não pode ser alterada durante a partida.
  - **Time limit:** 190 s (padrão), 120 s, 60 s, *Custom* (10–3600 s) ou *No limit* (o cronômetro mostra o tempo decorrido e não há derrota por tempo).
- **Etapas (um único cronômetro):** 1) arcada superior → 2) arcada inferior → 3) mordida do lado direito → 4) mordida do lado esquerdo → resultados. Na mordida, as duas arcadas aparecem em oclusão, vistas pela bochecha, com o rótulo "PATIENT RIGHT/LEFT" e os indicadores "RIGHT BITE / LEFT BITE" (pendente, em andamento, concluído ou riscado quando pulado). Uma etapa concluída avança sozinha; o jogador também pode avançar quando quiser com **NEXT**.
- **NEXT:** botão ao lado do indicador da próxima região, disponível em qualquer etapa e com qualquer progresso (até antes do primeiro toque, sem iniciar o cronômetro). Passa para a etapa seguinte preservando tudo o que já foi capturado (pontos, qualidade, mapa de calor, modelo do SCAN RESULT); nada é completado automaticamente e a etapa deixada para trás não é reaberta. Na última etapa o botão vira **RESULTS** e abre a tela de resultados como scan parcial. NEXT avança de etapa; FINISH SCAN encerra a sessão inteira.
- **Controles:**
  - **Computador:** botão esquerdo = scanner (escaneia); **botão direito + arrastar = girar a câmera** em qualquer direção (nunca escaneia, nunca seleciona dente, não altera o progresso); roda = zoom; ⌖ = vista inicial. O menu de contexto do navegador é bloqueado **só dentro da área 3D**.
  - **Celular/tablet:** um dedo = scanner; **dois dedos arrastando juntos = girar**; **pinça = zoom**. O gesto de dois dedos decide entre girar e zoom pela mudança acumulada desde o início (os navegadores enviam o movimento de cada dedo separadamente, então o "tremor" de um evento não decide nada). Gestos com dois dedos nunca movem o scanner; se um dedo sai, o outro fica parado até a tela ser liberada (sem salto do scanner). `touch-action: none` só na área 3D: sem rolagem nem zoom da página.
  - A rotação responde **diretamente** ao dedo/mouse (sem atraso nem inércia); só movimentos automáticos (centralizar, próxima etapa, bússola) são suavizados. Rotação de 360° em torno do centro da arcada; a inclinação é limitada para evitar vistas impossíveis.
  - Botões: modo SCAN/ROTATE (ROTATE: um dedo gira), mapa de qualidade, **bússola** (leva a câmera à próxima superfície pendente), −/+ e ⌖. A cabeça do scanner fica ~64 px acima da ponta do dedo. O cronômetro começa em 00:00 no primeiro toque de escaneamento.
- **Captura por superfície (o scanner só captura o que vê):**
  - Cada dente tem **5 superfícies independentes**: anteriores = vestibular (labial), lingual/palatina, mesial, distal e borda incisal; posteriores = vestibular, lingual/palatina, mesial, distal e oclusal. Capturar uma não marca as outras.
  - O scanner olha **para dentro da tela** no ponto sob o dedo; a janela fica a 10 mm da superfície mirada. Um ponto só ganha exposição se estiver **dentro do cone de captura** (raio de 8 mm na distância de trabalho), **dentro da faixa de profundidade** (2–21 mm), com a **superfície voltada para o scanner** (até 63°; **50° nas faces mesial/distal**, que exigem uma vista oblíqua intencional), sem ser visto **de baixo da gengiva** e **sem outro dente na linha de visão** (raio do ponto até o scanner testado contra as coroas vizinhas). Por isso, escanear a vestibular de um incisivo não captura a lingual nem as proximais dele: é preciso girar a arcada.
  - Pontos que nenhuma posição consegue ver (contatos apertados, áreas cobertas por papila) são excluídos na preparação, por raycasting. Uma superfície conta como capturada ao atingir **60 % (70 % nas proximais)** — cobertura razoável, não perfeição —; as pequenas falhas restantes são preenchidas com a qualidade média dela, como o software real faz. Áreas já capturadas não contam de novo; voltar a elas melhora a qualidade.
- **Janela ZOOM:** no canto superior direito do painel SCAN RESULT, uma terceira visualização ampliada (~7 mm ao redor) do ponto para onde o scanner aponta, vista da mesma direção da câmera, com o estado de captura (área sob o scanner destacada, malha, mapa de calor). Usa a mesma avaliação do scanner do quadro (nenhuma captura extra) e não recebe toques. Sem superfície válida (scanner levantado ou mirando o vazio): **"No surface detected"**.
- **FINISH SCAN:** botão no cabeçalho, disponível a qualquer momento (até antes do primeiro toque). Encerra a captura, preserva tudo o que foi capturado (pontos, qualidade, progresso) e abre a **mesma tela de resultados**, como **"SCAN FINISHED"** (parcial): progresso alcançado, qualidade das superfícies efetivamente capturadas, tempo de scan, recorde e o **modelo digital parcial** (as duas arcadas lado a lado, só o que foi capturado, sem preencher nada), com a situação de cada etapa: porcentagem capturada, "Complete" ou "Not performed"). Parcial **nunca** é vitória nem recorde.
- **CONTINUE SCANNING:** na tela de um scan finalizado, retoma exatamente de onde parou (mesmas superfícies, qualidades, etapa e progresso; o cronômetro continua do tempo já usado — o tempo na tela de resultados não conta, e nenhum tempo é acrescentado). Se a sessão continuada for concluída, é vitória ("SCAN COMPLETED!"), mas sem recorde (só scans sem pausa contam). *NEW SCAN* começa uma sessão limpa. Após "TIME'S UP!" não há continuar (sem tempo extra).
  - Feedback: a superfície no campo fica levemente destacada; disco do scanner laranja = capturando, cinza tracejado = inválido; elipse sobre a superfície mostra a orientação dela em relação ao scanner; mensagens curtas: "Capturing labial", "Surface not visible — rotate the view", "Reposition scanner — aim at a tooth", "Already captured here". A faixa de 5 chips mostra o estado de cada face do dente no scanner (ou do próximo dente).
- **Painéis ORIGINAL | SCAN RESULT:** a área central mostra, lado a lado (empilhados em telas com menos de 720 px de largura), a arcada que está sendo escaneada e o **modelo digital** construído a partir dela. O SCAN RESULT é uma segunda visualização 3D que desenha **somente as superfícies realmente capturadas** (dados reais de captura de cada ponto; o restante não existe no modelo, nem a gengiva), com a malha digital e, com o mapa de qualidade ligado, a qualidade de cada superfície. Ele segue a câmera do painel original até você arrastá-lo/dar pinça/roda nele (câmera própria, nunca move o scanner nem altera o progresso); o botão de corrente volta a sincronizá-lo, e cada nova etapa começa sincronizada.
- **Mordida:** pontos próprios na face vestibular dos posteriores, com as mesmas regras de visibilidade (as duas arcadas em oclusão bloqueiam a linha de visão). A captura vestibular da arcada **não** conta para a mordida.
- **Qualidade (mapa de calor):** **por ponto e por superfície**, calculada pela lógica do jogo, sem sorteio: movimento lento, permanência e superfície de frente aumentam a qualidade; passadas rápidas rendem pouco; acima de ~320 mm/s o scanner "perde o rastreio". Um ponto visto mas abaixo da qualidade mínima fica **vermelho (Rescan)** e não conta. Superfícies nunca vistas ficam **cinza** (sem nota). O botão de barras coloridas alterna entre a vista normal (malha digital laranja) e o mapa de qualidade, com legenda: verde = excelente, verde-claro = muito bom, amarelo = intermediário, laranja = baixo, vermelho = reescanear, cinza = não escaneado. A legenda informa que é uma simulação, **não uma medição clínica**. A qualidade média aparece na tela de vitória.
- **Orientação:** as superfícies pendentes do próximo dente brilham em laranja (vista normal); um anel pulsante mostra onde encostar quando há uma superfície pendente visível; se todas estiverem do outro lado, a mensagem pede para girar e a bússola pisca. A barra segmentada mostra as regiões da etapa (dentes removidos não geram região pendente).
- **Anatomia:** incisivos e caninos têm geometria própria (não são cápsulas): coroas achatadas no sentido vestibulolingual, face vestibular larga e suave, borda incisal definida com ângulo mesial mais vivo e distal mais arredondado, laterais mais estreitos e com ângulos mais arredondados que os centrais, fossa lingual com cristas marginais e cíngulo, caninos robustos com cúspide definida, crista vestibular e arestas mesial/distal assimétricas, inclinação vestibular, colo mais estreito. Os dentes decíduos têm colo mais bulboso e ângulos mais arredondados. A gengiva tem papilas interdentais.
- **Fim:** todas as etapas completas antes do limite = vitória ("SCAN COMPLETED!"; se alguma etapa foi pulada com NEXT, o resultado é parcial mesmo que as seguintes sejam concluídas); limite atingido = "TIME'S UP!" com o progresso, a qualidade do que foi capturado e o modelo digital (os dados não são apagados); FINISH SCAN = "SCAN FINISHED" (parcial). Depois do fim, nenhum toque altera o resultado. Na tela de resultado: *CONTINUE SCANNING* (só parcial), *PLAY AGAIN / TRY AGAIN / NEW SCAN* (mesmo paciente, sessão limpa), *Change patient*, *Back to start*.
- **Formato da arcada:** curva em U gerada por curvatura contínua (anterior arredondada, posteriores levemente divergentes). Adulto superior: ~32 mm entre caninos e ~52 mm entre segundos molares; infantil: arcada mais curta e ovoide. Ajustável em `DENTITIONS` (`turn`, `spread`) em `js/arch.js`.
- **Cronômetro confiável:** usa o relógio real (`performance.now()` e `Date.now()`, o maior dos dois), nunca a contagem de quadros. Se o participante sair do navegador ou trocar de aba, **o tempo continua correndo**; ao voltar, se o limite passou, a rodada termina como "TIME'S UP!", senão aparece o aviso "The timer kept running…". Deixar a aba em segundo plano não dá vantagem.
- **Recorde:** salvo somente quando **todas as etapas** (duas arcadas e duas mordidas) são concluídas dentro do limite, **sem pausa** (FINISH + CONTINUE), e o tempo é melhor que o anterior. Vale para qualquer modo de tempo (é o tempo da varredura completa). Aparece na tela inicial e na de resultado.

## Executar e testar localmente

Opção 1 — abrir direto: dê dois cliques em `index.html` (funciona no navegador do computador).

Opção 2 — servidor local (recomendado, permite testar no celular na mesma rede Wi-Fi). Com Node.js instalado, dentro da pasta do projeto:

```bash
npx --yes serve -l 8080 .
```

Abra `http://localhost:8080` no computador. No celular (mesma rede), abra `http://IP-DO-COMPUTADOR:8080` (o IP aparece em `ipconfig`, campo "Endereço IPv4"). Se não abrir, o Firewall do Windows pode estar bloqueando a porta.

No Chrome do computador, para simular celular: F12 → ícone de celular (Toggle device toolbar) → escolha um iPhone/Android.

**Ensaio rápido:** acrescente `?limit=20` ao endereço para pré-selecionar um limite *Custom* de 20 s (útil para ver a tela "TIME'S UP!"). O limite também pode ser escolhido na configuração do paciente.

**Zerar o recorde do aparelho:** apague os dados do site no navegador (Configurações → Privacidade → Dados de sites) ou use uma aba anônima.

## Publicar gratuitamente com HTTPS

Qualquer hospedagem de site estático serve; não há build. Escolha uma:

### Opção A — Netlify Drop (mais rápida, ~2 min)

1. Acesse https://app.netlify.com/drop e crie uma conta gratuita (ou entre).
2. Arraste a **pasta inteira** `intraoral-scanner-challenge` para a área indicada.
3. Em segundos você recebe um endereço como `https://nome-aleatorio.netlify.app`.
4. Em *Site configuration → Change site name* você pode escolher um nome melhor (ex.: `scanner-challenge`).
5. Para atualizar depois: *Deploys* → arraste a pasta de novo.

> Sem estar logado, o Netlify Drop pode apagar o site após um tempo — faça o deploy logado.

### Opção B — GitHub Pages

1. Crie uma conta em https://github.com e um repositório **público** novo (ex.: `scanner-challenge`).
2. Na página do repositório: *Add file → Upload files* → arraste o **conteúdo** da pasta (`index.html`, `css/`, `js/`, `assets/`, `README.md`) → *Commit changes*. O `index.html` precisa ficar na raiz do repositório.
3. *Settings → Pages* → em *Build and deployment*, *Source*: **Deploy from a branch**; *Branch*: `main` / `/ (root)` → *Save*.
4. Aguarde 1–2 minutos e recarregue a página de *Settings → Pages*: aparece o endereço `https://SEU-USUARIO.github.io/scanner-challenge/`.

### Opção C — Cloudflare Pages

1. https://dash.cloudflare.com → *Workers & Pages* → *Create* → *Pages* → *Upload assets*.
2. Dê um nome ao projeto e envie a pasta. O endereço será `https://NOME.pages.dev`.

Depois de publicar, **abra o endereço no seu celular** antes de gerar o QR Code.

## Gerar o QR Code (depois de publicar)

Use **exatamente** o endereço HTTPS publicado (copie da barra de endereços do celular, onde o jogo já abriu).

- **Chrome no computador:** abra o jogo publicado → clique no ícone de compartilhar na barra de endereços (ou menu ⋮ → *Transmitir, salvar e compartilhar*) → *Criar código QR* → *Baixar*. Gratuito, sem cadastro, sem redirecionamento.
- **Linha de comando (Node.js):**

  ```bash
  npx --yes qrcode -o qr-scanner-challenge.png -w 1024 "https://SEU-ENDERECO-PUBLICADO"
  ```

Recomendações:
- Prefira geradores que codificam a URL **diretamente**. Evite serviços de "QR dinâmico" que passam por um encurtador próprio: eles podem expirar, exigir assinatura ou exibir anúncios.
- Na projeção, deixe o QR grande (pelo menos ~25 % da altura do slide), preto sobre branco, com margem branca em volta. Coloque a URL curta escrita embaixo como alternativa.
- Teste o QR projetado na sala, a 3–5 m, com um Android e um iPhone.

## Personalização

- **Textos / idiomas:** `js/strings.js` tem um objeto por idioma (`en` é a base; chave que faltar em outro idioma usa o inglês). Para adicionar um idioma: crie o objeto, registre em `ISC_LOCALES` e em `ISC_LANGUAGES`. `{seconds}`, `{limit}`, `{n}`, `{pct}` e `{face}` são preenchidos automaticamente.
- **Cores:** variáveis no topo de `css/styles.css` (`--orange`, `--ink`, cinzas). As cores desenhadas no canvas (malha laranja, scanner) estão em `js/arch.js` e `js/app.js` como `#FF6A13` / `rgba(255,106,19,…)`.
- **Nome/selo:** texto `brand` em `js/strings.js` e o símbolo SVG no topo de `index.html`. Não há marcas de terceiros.
- **Dificuldade — campo do scanner** (`CONFIG` no topo de `js/capture.js`):
  - `FIELD_RADIUS` (raio do campo, mm) — maior = mais fácil;
  - `WORK_DIST`, `DEPTH_MIN`, `DEPTH_MAX` (distância de trabalho e profundidade de campo, mm);
  - `ANGLE_TOL` (ângulo máximo entre a superfície e o scanner, graus) e `PROXIMAL_ANGLE_TOL` (o mesmo para mesial/distal, mais estrito para que a vestibular não complete as proximais);
  - `MIN_ELEV` (impede ver por baixo da gengiva), `AIM_TOLERANCE` (tolerância de mira quando o dedo cai entre dentes).
- **Dificuldade — captura** (topo de `js/app.js`):
  - `EXPOSURE_NEEDED` (segundos por ponto) — maior = mais difícil;
  - `SPEED_FULL` / `SPEED_ZERO` / `SPEED_LOST` (velocidades de qualidade máxima, ganho zero e perda de rastreio, mm/s);
  - `QUALITY_RATE` e `QUALITY_TO_CAPTURE` (rapidez do ganho de qualidade e qualidade mínima para contar);
  - `FACE_COMPLETE` (fração de cada superfície para considerá-la capturada e preencher as falhas: 0,6; proximais 0,7);
  - `TOUCH_OFFSET` (distância entre dedo e cabeça do scanner, px).
  - O limite de 190 s está em `readLimitMs()`.
- **Anatomia:** perfis das coroas anteriores em `ANTERIOR` (`js/arch.js`): largura cervical, arredondamento dos ângulos incisais, cúspide do canino, espessuras vestibular/lingual, fossa, crista, inclinação. Densidade dos pontos: `SAMPLE_SPACING` e `PROXIMAL_SPACING`.
- **Cores dos dentes:** lista `SHADES` no topo de `js/app.js`.

Referência dos testes automatizados (código real do jogo, jogador-robô que varre as superfícies visíveis e usa a bússola quando não há nenhuma), com a dificuldade atual (mais tolerante): adulto completo em **~42 s** (arcada superior ~21 s, inferior ~17 s, mordidas ~4 s); antes do ajuste eram ~65 s. Uma pessoa sem treino deve levar algo como 2–2,5× isso (≈ 85–105 s) — meta de 60–120 s, **ainda não verificada com pessoas**. Um resultado parcial aparece em poucos segundos (6 % em ~3 s no teste). Para facilitar mais, aumente `FIELD_RADIUS` ou reduza `FACE_COMPLETE`; para dificultar, o inverso.

`?debug=1` expõe ganchos para esses testes automatizados (inclusive `tick()`, que executa o mesmo passo de captura sob demanda); o jogo não depende dele.

## Checklist antes da apresentação

1. Abrir a URL publicada em um **iPhone (Safari)** e um **Android (Chrome)**, com Wi-Fi e com 4G.
2. Ler o QR projetado a 3–5 m com os dois aparelhos.
3. Jogar uma partida completa até "SCAN COMPLETED!" e conferir tempo e recorde.
4. Jogar de novo pior (ou com `?limit=20`) e confirmar que o recorde **não** muda e a tela "TIME'S UP!" aparece com o progresso.
5. Fechar e reabrir o navegador: o recorde continua na tela inicial.
6. Durante uma partida, ir para a tela inicial do celular por ~10 s e voltar: o tempo deve ter avançado e aparecer o aviso.
7. Girar o celular e testar uma tela pequena (ex.: iPhone SE): tudo legível, sem rolagem durante o jogo.
8. Testar com o modo economia de bateria ligado (animações continuam suaves, cronômetro correto).
9. Confirmar que a página não pede nenhuma permissão e não mostra pop-ups.
10. Testar nos celulares reais: girar com dois dedos, pinça, modo ROTATE e botão de centralizar; conferir que girar não escaneia.
11. Configurar um paciente infantil, remover alguns dentes, mudar a cor e jogar até o fim (incluindo as duas mordidas).
12. Ligar o mapa de qualidade, passar rápido sobre um dente (fica vermelho/laranja) e depois devagar (melhora).
13. Escanear só a face vestibular de um incisivo e conferir nos chips que palatina, mesial e distal continuam pendentes; girar (dois dedos ou botão direito) e capturar a palatina.
14. No computador: girar com o botão direito sem que o scanner capture nada; roda do mouse para zoom.
15. Jogar uma partida inteira com alguém que nunca viu o jogo e cronometrar: se passar de 190 s com frequência, aumente `FIELD_RADIUS`.

## Limitações conhecidas

- O 3D usa WebGL. Em um navegador sem WebGL (raro), a tela de configuração mostra um aviso e o jogo não inicia.
- A oclusão é testada contra uma cópia simplificada de cada coroa (metade dos vértices); a gengiva não é testada como obstáculo — em vez disso, o scanner não pode olhar de baixo da linha gengival e as áreas cobertas pela gengiva/papila não têm pontos.
- Na região vestibular das ameias, parte das faces proximais dos vizinhos é visível de frente (como na realidade); por isso elas podem avançar parcialmente quando você escaneia a vestibular, mas só completam com 90 %, o que exige uma vista oblíqua.
- A mordida é uma simulação visual simplificada (arcadas posicionadas em oclusão de Classe I aproximada), não um registro oclusal real.
- O primeiro dedo de um gesto de pinça no modo SCAN inicia o cronômetro (ainda não se sabe que virá um segundo dedo); nada é capturado enquanto dois dedos estão na tela.
- O recorde é por aparelho e por navegador; em modo anônimo alguns navegadores apagam o `localStorage` ao fechar (o jogo continua funcionando, guardando o recorde só na sessão).
- Vibração ao completar uma superfície só ocorre em aparelhos que suportam (Android); no iPhone é ignorada sem erro.
- Não há ranking global nesta versão (de propósito: nenhum dado pessoal é coletado).
