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
- [ ] add posts and blogs + affiliate marketing
- [ ] comment funktion for users? 
- [ ] Pentomino Spiel mit Hilfe von pygbag formatieren/updaten: cd Pentomino_Python pygbag . 
- [ ] change profile picture 
- [ ] edit contemplations
- [ ] switch: german and english language (eiheitliche Spraches)

- [ ] Feedback Pentomino einbauen: 
        1. ghostpiece entweder durch p erscheinen lassen oder drag&drop benutzen, dazu: schwerpunkt des Steins bestimmen, dann in raster ablegen entsprechend dem Schwerpunkt
        2. das "ready to start" zum spielbeginn statt nur per mausklick auch durch touch ansteuern (Handykompatibilität) -> buttons für 100% touch kompatibilität 
        4. Seitenverhältnisse anpassen, dass keine schwarzen Balken im Fensterrand sind
        5. gezogene und noch zu ziehende Steine besser voneinander abheben (mehr Platz?)


- [ ] Zu Beginn Modus auswählen: Two Player Modus + Singel Player Modus Pentomino (Puzzle Modus) + Singel Player Modus gegen KI (für Website bieten sich dafür Hidden_Posts an) 
- [ ] Ranglistenspiele 