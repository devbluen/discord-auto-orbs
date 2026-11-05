# discord-orbs

[English](README.md) · **Português**

Completa as missões (quests) no aplicativo oficial do Discord para Windows e Linux.

<img width="380" height="622" alt="Captura de tela 2026-10-24 012409" src="https://github.com/user-attachments/assets/c0acd6c7-c931-4487-a944-cefabc5b4efa" />

## Instalar (jeito mais fácil)

1. Entre em [Releases](https://github.com/devbluen/discord-auto-quest/releases/latest) e baixe o `discord-orbs-<versão>.exe` (ex.: `discord-orbs-1.2.0.exe`).
2. Abra o arquivo. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** → **Executar assim mesmo** (o exe não é assinado).
3. Digite `1` (Install / update) e aperte Enter, depois `Y` para reiniciar o Discord.
4. No Discord, abra a página de **Missões**. Um painel aparece no canto inferior direito e começa a trabalhar.

Para remover: abra o exe de novo e escolha `2` (Uninstall).

## Linux

Use o Discord oficial para desktop. Instale Node.js 22 ou mais novo, baixe `discord-orbs-linux-<versão>.tar.gz` em [Releases](https://github.com/devbluen/discord-auto-quest/releases/latest) e extraia o arquivo. Dentro da pasta extraída `discord-auto-quest-<versão>`, rode `node src/cli.cjs install`. Feche o Discord por completo e abra de novo. Para missões de jogos, instale Wine; o pacote inicia automaticamente um exe pequeno que roda fora da tela (`dummy-game-win.exe`, compilado pelo workflow a partir de `src/dummy-game-win.c`; ele só existe no pacote Linux, não no exe de Windows). Se usar um `git clone` em vez do pacote, instale o MinGW (`gcc-mingw-w64-x86-64`) e rode `npm run build:dummy`. Para remover o patch, rode `node src/cli.cjs uninstall` e reinicie o Discord.

## Gerar o exe você mesmo

Use este caminho se preferir não rodar um exe gerado por outra pessoa.

1. Instale o [Git](https://git-scm.com/download/win) e o [Node.js 22 ou mais novo](https://nodejs.org/) (botão "LTS"). Pode deixar as opções padrão.
2. Abra o **PowerShell** (menu Iniciar → digite `PowerShell`) e rode, uma linha por vez:

   ```
   git clone https://github.com/devbluen/discord-auto-quest.git
   cd discord-auto-quest
   npm install
   npm run build
   ```

3. O exe fica em `discord-auto-quest\dist\discord-orbs.exe` (dentro da sua pasta de usuário, ex.: `C:\Users\<você>\`). Abra e siga os passos 2 a 4 de [Instalar](#instalar-jeito-mais-fácil).

Para atualizar depois, rode dentro da pasta `discord-auto-quest`:

```
git pull
npm install
npm run build
```

e abra o exe novo (`1`, Install / update).

## Como funciona

- Aceita sozinho as missões que consegue completar (botão **Auto-accept** no painel).
- Ordem: primeiro as que dão mais orbs por minuto restante, depois as sem orbs, das mais curtas para as mais longas.
- O painel mostra a fila, o progresso e os erros. Os botões são **Check now** (verificar agora), **Pause** (pausar), **Copy report** (copiar relatório) e **Claim** (abre a página de missões para resgatar a recompensa).
- Uma bolinha vermelha no painel (mesmo minimizado) conta as recompensas prontas para resgatar; passe o mouse para ver o total de orbs.
- Arraste o orb (ou o painel aberto pelo cabeçalho) para qualquer lugar; clique duas vezes no cabeçalho para voltar ao canto. A posição, o idioma e as chaves ficam salvos.
- Português e inglês: segue o idioma do Discord, ou troque pelo botão **EN/PT** no painel.
- Seção **Insígnias**: mostra as insígnias do seu perfil e como conseguir as que uma conta pode obter sozinha. Missão vem de completar qualquer missão (a fila faz isso), HypeSquad é uma casa grátis em um clique, Orbs abre a Loja (comprar é com você) e Desenvolvedor Ativo abre o guia oficial (precisa de um bot seu). Insígnias pagas ou dadas pela equipe do Discord não podem ser obtidas por script.
- Seção **Jogar**: busque na lista de jogos do Discord, escolha os jogos e clique em **Iniciar**. Com um jogo o Discord conta horas jogadas; com vários o script alterna entre eles (a cada 10, 30 ou 60 min) para contarem como jogos jogados. É disso que vêm as insígnias de jogo do perfil (tempo de jogo, jogos jogados). O Discord conta tempo real e só com ele aberto; a sessão volta sozinha depois de reiniciar. Aparece como "Jogando …" para todo mundo, como um jogo de verdade. Só no Windows.
- **Instantâneo** (dentro de Jogar): em vez de esperar em tempo real, manda sessões já terminadas direto para os dados de atividade do Discord (`/science`), como o [BadgeFarmer](https://github.com/aboveproof/BadgeFarmer) faz (MIT; baseado no gameSessionSpoofer e no discord-streamer). **Horas jogadas** credita 100, 1.000 ou 5.000 h no primeiro jogo da sua lista em poucos minutos; **Jogos jogados** credita 100 jogos aleatórios; **Horas transmitidas** precisa de uma live real com alguém assistindo e conta 10 h por minuto real. As insígnias atualizam de madrugada (1 a 3 dias) e só com Privacidade e Segurança → "Usar dados para personalizar" ligado. Mandar milhares de horas em minutos é um padrão óbvio se o Discord resolver olhar.
- Notificações na área de trabalho quando uma missão termina, falha ou quando a fila inteira acaba. Clicar numa delas abre a página de missões. Ligue/desligue em **Notifications** no painel.
- Verificação de atualização: a cada 6 horas procura uma [release](https://github.com/devbluen/discord-auto-quest/releases) mais nova. Se houver, o painel mostra **Update available** com um botão **Download** e manda uma notificação na área de trabalho (uma vez por versão). O menu do exe também avisa.
- Quando o Discord atualiza, o script se reaplica sozinho na versão nova se ela já estiver baixada quando o Discord fechar. Se o painel sumir depois de uma atualização, abra o exe e instale de novo.

| Tipo | Como |
| --- | --- |
| `WATCH_VIDEO` / `WATCH_VIDEO_ON_MOBILE` | envia o progresso do vídeo respeitando o limite de tempo do servidor |
| `PLAY_ON_DESKTOP` | no Discord oficial para Windows, finge o processo do jogo; no Discord oficial para Linux, acompanha um jogo detectado pelo Discord |
| `PLAY_ACTIVITY` | manda um heartbeat a cada 20 s usando uma DM ou canal de voz |

`STREAM_ON_DESKTOP` é **assistida** e ainda não testada: o Discord só conta enquanto você transmite de verdade com outra pessoa no canal de voz, e isso um script não consegue fingir. Transmita qualquer janela com um amigo (ou uma segunda conta) na call; o script percebe e faz o Discord ler a transmissão como o jogo da missão. Até lá a missão espera em *Precisam de atenção* sem travar a fila.

Não suportadas: missões de conquista.

## Deu problema?

Clique em **Copy report** no painel e cole numa nova [issue](https://github.com/devbluen/discord-auto-quest/issues). O relatório tem dados das missões e o seu ID de usuário do Discord, nunca o seu token.

## Desenvolvimento

- `npm run autostart` instala apontando direto para o `src/` deste repositório, então qualquer mudança vale com Ctrl+R no Discord. `npm run autostart:remove` remove e `npm run status` mostra o estado.
- `npm run check` verifica a sintaxe de todos os arquivos.
- O `discord-orbs.exe` também aceita argumentos: `install|uninstall|status [--yes]`.
- As releases são publicadas pelo workflow **Release**, que só roda manualmente: Actions → Release → Run workflow, com uma tag como `v1.0.0`.

| Arquivo | Papel |
| --- | --- |
| `src/quests.js` | Roda dentro da janela do Discord: acha os módulos internos, aceita e completa as missões, desenha o painel |
| `src/inject.cjs` | Carregado pelo processo principal do Discord; injeta o `quests.js` na janela e reaplica o patch depois de atualizações |
| `src/patcher.cjs` | Acha as instalações do Discord e adiciona/remove a linha no `discord_desktop_core/index.js` que carrega o `inject.cjs` |
| `src/cli.cjs` | Instalador (menu e comandos); é o ponto de entrada do exe |
| `scripts/build.js` | Gera o exe como Node single executable application |
| `.github/workflows/release.yml` | Workflow manual que gera o exe e publica uma release |

## Segurança

- Não lê nem envia seu token: as requisições das missões passam pelo cliente HTTP interno do Discord, só para `discord.com`.
- A única outra requisição é a verificação de atualização: um GET anônimo para `api.github.com/repos/devbluen/discord-auto-quest/releases/latest`, sem nenhum dado do Discord.
- Sem porta de debug e sem baixar código de fora.
- Cada release vem com um checksum `.sha256` para cada download; o exe é gerado pelo GitHub Actions a partir do código público.

**Isso viola os Termos do Discord.** A conta pode ter as missões suspensas ou ser banida. Use por sua conta e risco.
