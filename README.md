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

And you're all set! Head over to http://127.0.0.1:4000/ to see your site in action.


## Deploy on github

Simply create a new branch, e.g., gh-pages. Then go to the github settings > Pages > Branch and select gh-pages as your branch. Done.
