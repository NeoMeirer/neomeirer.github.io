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


There are 3 ways to install this theme

1. Install it as a Ruby Gem (for self-hosted sites)
2. Install it with the `jekyll-remote-theme` plugin (for GitHub Pages hosted sites)
3. Fork the project directly

### Ruby Gem method
1. Add this line to your `Gemfile`:

```ruby
gem "tale"
```

2. Install the theme's gems and dependencies:

```bash
$ bundle
```

3. In `_config.yml` add these lines:

```yaml
theme:      tale

permalink:  /:year-:month-:day/:title
paginate:   5
```

Remove any other `theme:` lines.

4. Rename `index.md` to `index.html`. Without this, the `jekyll-paginate` gem will not work.

5. In `about.md`, change the `layout:` field to `post`:

```Markdown
layout: post
```

### GitHub Pages method
1. Add these 2 lines in to your `Gemfile`:

```ruby
gem "jekyll-remote-theme"
gem "jekyll-paginate"
```

2. Install the newly added gems:

```bash
$ bundle
```

3. In `_config.yml` add these lines:

```yaml
remote_theme: chesterhow/tale

permalink:    /:year-:month-:day/:title
paginate:     5

plugins:
  - jekyll-paginate
  - jekyll-remote-theme
```

Remove any other `theme:` or `remote_theme:` lines.

4. Rename `index.md` to `index.html`. Without this, the `jekyll-paginate` gem will not work.

5. In `about.md`, change the `layout:` field to `post`:

```Markdown
layout: post
```

### Fork method
1. Fork this repository

2. Delete the unnecessary files/folders: `CODE_OF_CONDUCT.md`, `LICENSE`, `README.md`, `tale.gemspec`

3. Delete the `baseurl` line in `_config.yml`:

```yaml
baseurl:  "/tale"   # delete this line
```

## Usage
Once you've installed the theme, you're ready to work on your Jekyll site. To start off, I would recommend updating `_config.yml` with your site's details.

To build and serve your site, run:

```bash
$ bundle exec jekyll serve
```

And you're all set! Head over to http://127.0.0.1:4000/ to see your site in action.

### Enabling Comments
Comments are disabled by default. To enable them, look for the following line in `_config.yml` and change `jekyll-tale` to your site's Disqus id.

```yml
disqus: jekyll-tale
```

Next, add `comments: true` to the YAML front matter of the posts which you would like to enable comments for.

## Contributing
Found a bug or have a suggestion? Feel free to create an issue or make a pull request!

## License
See [LICENSE](https://github.com/chesterhow/tale/blob/master/LICENSE)
