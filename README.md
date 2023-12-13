# Personal website

Following the template of chesterhow/tale. Thanks for the beatiful simplistic design! 

This is how I use it locally:

## Installation
Create a new conda environment: ```conda create -n website```.

Now install the necessary software:
```bash
conda install -c conda-forge c-compiler compilers cxx-compiler
conda install -c conda-forge ruby
gem install bundler
```

Clone this repo and ```cd``` into the repo.

Then run:
```bash
bundle install --path /Users/$USER/miniconda3/envs/website/bin/custom_bundler_path
```

Check successful installation with:
```bash
bundle exec jekyll -v
```

## Usage
Once you've installed the theme, you're ready to work on your Jekyll site. To start off, I would recommend updating `_config.yml` with your site's details.

To build and serve your site, run:

```bash
bundle exec jekyll serve
```

And you're all set! Head over to http://127.0.0.1:4000/ to see your site in action.


## Deploy on github

Simply create a new branch, e.g., gh-pages. Then go to the github settings > Pages > Branch and select gh-pages as your branch. Done.
