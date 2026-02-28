---
layout: post
title: "Pentomino"
author: "Neo"
tags: games
---

<style>
  #pentomino-game {
    width: 50vw;
    height: 30vw;
    max-width: 800px;
    max-height: 480px;
    display: block;
    margin: 0 auto;
    border: none;
  }
</style>

<iframe id="pentomino-game" src="/Pentomino_Python/build/web/index.html" allowfullscreen webkitallowfullscreen mozallowfullscreen></iframe>

<button onclick="toggleFullscreen()">Vollbildmodus</button>

<script>
function toggleFullscreen() {
  const iframe = document.getElementById('pentomino-game');
  if (iframe.requestFullscreen) {
    iframe.requestFullscreen();
  } else if (iframe.mozRequestFullScreen) { // Firefox
    iframe.mozRequestFullScreen();
  } else if (iframe.webkitRequestFullscreen) { // Chrome, Safari and Opera
    iframe.webkitRequestFullscreen();
  } else if (iframe.msRequestFullscreen) { // IE/Edge
    iframe.msRequestFullscreen();
  }
}
</script>


# Spielregeln

## 1. Ziehphase
Zu Beginn werden die Spielsteine abwechselnd gezogen. Hier fängt Spieler 1 an. Spieler 2 zieht den zweiten Spielstein. Dies geht so weiter, bis alle Spielsteine verteilt sind.

## 2. Platzierphase
Die Spieler legen abwechselnd einen ihrer Spielsteine auf das Spielfeld. Dabei ist es egal, wo die Steine auf dem Spielfeld platziert werden, man darf nur keinen anderen Spielstein bedecken. Es beginnt derjenige Spieler mit dem Legen, der nicht begonnen hat zu ziehen. (Hier Spieler 2)

## 3. Spielende
Die Spielrunde ist zu Ende, wenn der Spieler, der an der Reihe ist, keinen Spielstein mehr auf das Spielfeld legen kann.

### Gewinner:
Der Spieler, der als letzter einen Spielstein platzieren konnte, gewinnt das Spiel.