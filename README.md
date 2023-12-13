# Website

## Installation
Create a new conda environment: ```conda create -n website```.

Now install the necessary software (make sure the install-dir is correct):
```bash
conda install -c conda-forge c-compiler compilers cxx-compiler
conda install -c conda-forge ruby
gem install bundler
```

Clone this repo and ```cd``` into the repo.

Change the Gemfile to the following:
```
# frozen_string_literal: true

source "https://rubygems.org"
gem "jekyll-remote-theme"
gem "jekyll-paginate"
```

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
$ bundle exec jekyll serve
```

And you're all set! Head over to http://127.0.0.1:4000/ to see your site in action.
