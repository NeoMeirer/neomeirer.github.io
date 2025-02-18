---
layout: post
title: "Pentomino"
author: "Neo"
tags: games
---

<style>
  #pentomino-game {
    width: 100%;
    height: 29vh;
    border: none;
  }
</style>

<iframe id="pentomino-game" src="/Pentomino_Python/build/web/index.html" allow="fullscreen" allowfullscreen webkitallowfullscreen mozallowfullscreen></iframe>

<button onclick="toggleFullscreen()">Vollbildmodus</button>

<script>
function toggleFullscreen() {
  const iframe = document.getElementById('pentomino-game');
  
  // Prüfe, ob Fullscreen unterstützt wird
  if (isFullscreen()) {
    // Falls bereits im Fullscreen → Beenden
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    } else if (iframe.requestFullscreen) {
    // Versuche, den Fullscreen-Modus zu aktivieren
    const requestFullscreen = iframe.requestFullscreen || iframe.webkitRequestFullscreen || iframe.mozRequestFullScreen || iframe.msRequestFullscreen;
    if (requestFullscreen) {
      requestFullscreen.call(iframe);
    }
    if (iframe.requestFullscreen) {
      iframe.requestFullscreen();
    } else if (iframe.webkitRequestFullscreen) {
      iframe.webkitRequestFullscreen();
    } else if (iframe.mozRequestFullScreen) { // Firefox
      iframe.mozRequestFullScreen();
    } else if (iframe.msRequestFullscreen) { // IE/Edge
      iframe.msRequestFullscreen();
    }
  }
}
function isFullscreen() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
}
</script>

# Spielregeln
## 1. Ziehphase
Zu Beginn werden die Spielsteine abwechselnd gezogen. Hier fängt Player 1 an. Player 2 zieht den zweiten Spielstein. Dies geht so weiter, bis alle Spielsteine verteilt sind. 
## 2. Platzierphase
Die Spieler legen abwechselnd einen ihrer Spielsteine auf das Spielfeld. Dabei ist es egal, wo die Steine auf dem Spielfeld platziert werden, man darf nur keinen anderen Spielstein bedecken. Es beginnt derjenige Spieler mit dem Legen, der nicht begonnen hat. (Hier Player 2)
## 3. Spielende
Die Spielrunde ist zu Ende, wenn der Spieler, der an der Reihe ist, keinen Spielstein mehr auf das Spielfeld legen kann.