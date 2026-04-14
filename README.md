# Personal website

Following the template of chesterhow/tale. Thanks for the beautiful simplistic design! 

This is how I use it locally:

## Usage

I use devcontainers for the development and for testing changes locally (devcontainer.json is provided).

Clone this repo and ```cd``` into the repo.

First install jekyll.
```bash
bundle install
```

Check successful installation with:
```bash
bundle exec jekyll -v
```

To build and serve your site, run:
```bash
bundle exec jekyll serve
```

Pentomino Spiel mit Hilfe von pygbag formatieren/updaten
```bash
 cd Pentomino_Python 
 pygbag . 
 ```
Dann Code, der Mausklick simuliert, am Ende des <body>-Tags in der index.html (Pentomino_Python/build/web/index.html) einfügen um "Ready to Start!" Bildschirm automatisch zu übersprigen:
<script>
        document.addEventListener('DOMContentLoaded', function() {
        // Simuliere einen Klick auf den Startbildschirm nach einer kurzen Verzögerung (z.B. 1 Sekunde)
        setTimeout(function() {
                const canvas = document.querySelector('canvas');
                const event = new MouseEvent('click', {
                'view': window,
                'bubbles': true,
                'cancelable': true
                });
                canvas.dispatchEvent(event);
        }, 1000);
        });
</script>


Use if changes are not deployed or in case of bugs
```bash
bundle exec jekyll clean
bundle exec jekyll build
bundle exec jekyll serve
```

## Deploy on github

Simply create a new branch, e.g., gh-pages. Then go to the github settings > Pages > Branch and select gh-pages as your branch. Done.

To update on github
```bash
git add .
git commit -m "comment"
git push
```

My TODOs:

- [ ] learn about markdown syntax (to write posts properly)
- [ ] add posts and blogs

KickerTicker Verbesserungen:


- [ ] akutell kann nur admin Spiele eintragen, aber es sollte eigentlich auch Spieler Spiele eintragen können
- [ ] Archivierung richtig machen, also alles zurücksetzten und vergangenen Saisons anzeigen


- [ ] Erfahrung bei Spieler-Analyse (Radar) entfernen und Angriff und Verteidigung anders berechnen 
- [ ] Hinzufügen des Chemie-Bonus: Welche Spielerpaare performen besser als erwartet? (Tatsächliche Gewinnrate vs. erwartete basierend auf Einzel-Elos)
- [ ] Logik nochmal überprüfen 
- [ ] aktuelle Saison als Default 
- [ ] Passwort für Admin und Spieler nicht im Code anzeigen (vllt über Supabase)
- [ ] Kicker Liga Pro Überschrift in die Mitte
- [ ] Ergebnisse der letzten Spiele alle mittig übereinander 


- [ ] man soll die Gewinn-Prognose sehen, bevor man ein Spiel einträgt
- [ ] Vernändern sich Stats richtig, wenn man Spiele löscht 