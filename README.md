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

 Dann Code, der Muasklick simuliert, am Ende des <body>-Tags in der index.html (Pentomino_Python/build/web/index.html) einfügen um "Ready to Start!" Bildschirm automatisch zu übersprigen:
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



My TODOs:

- [ ] learn about markdown syntax (to write posts properly)
- [ ] add posts and blogs + affiliate marketing + advertisement 
- [ ] comment funktion for users? 
- [ ] change profile picture? 
- [ ] add contemplations
- [ ] switch: german and english language (eiheitliche Sprache)

- [ ] Feedback Pentomino einbauen: 
        1. Ergänzung Drag&Drop (Schwerpunkt des Steins bestimmen)
        2. Buttons: 100% Touch Spielbarkeit
        3. "Aufgeben"-Button hinzufügen
        4. Modi: Two Player Modus + Singel Player Modus Pentomino (Puzzle Modus) + Singel Player Modus gegen KI (für Website bieten sich dafür Hidden_Posts an)
        5. Ranglistenspiele 