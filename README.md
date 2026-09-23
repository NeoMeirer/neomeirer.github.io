# neolabs (neomeirer.github.io)

Persönliche Website von Neo Meirer — Jekyll auf Basis von [chesterhow/tale](https://github.com/chesterhow/tale).

## Wichtig: Branch

**Live und Quelle der Wahrheit ist `gh-pages`.** GitHub Pages deployt von diesem Branch.

Der Branch `master` ist veraltet (älteres Template) und sollte nicht für Änderungen genutzt werden. Als Nächstes: `master` an `gh-pages` angleichen oder `gh-pages` als Default-Branch setzen.

## Lokal entwickeln

```bash
bundle install
bundle exec jekyll serve
```

Devcontainer liegt unter `.devcontainer/`.

Bei Deploy-Problemen:

```bash
bundle exec jekyll clean
bundle exec jekyll build
bundle exec jekyll serve
```

## Pentomino (Web)

```bash
cd Pentomino_Python
pygbag .
```

Danach in `Pentomino_Python/build/web/index.html` am Ende von `<body>` den Auto-Klick einfügen, damit der „Ready to Start!“-Screen übersprungen wird (siehe frühere README-Notiz im Git-Verlauf).

## Deploy

Auf `gh-pages` committen und pushen. Pages-Einstellung im Repo: Branch `gh-pages`.
